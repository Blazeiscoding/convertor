/**
 * GPU hardware acceleration detection and encoder selection.
 *
 * Probes available GPU encoders at startup, caches the result, and provides
 * output-option helpers that can be swapped into converter.js.  Falls back to
 * CPU codecs silently when no GPU is detected or when a test encode fails.
 */

const { execFile } = require("node:child_process");

/** Probe result, populated once by `detectHardwareAcceleration`. */
let cachedCapabilities = null;
let detectionPromise = null;

/**
 * Run a tiny FFmpeg test encode to prove a given encoder actually works on
 * the current machine (driver installed, GPU present, etc.).
 */
function testEncoder(ffmpegPath, encoder, extraArgs = []) {
  return new Promise((resolve) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=256x256:d=0.1",
      "-frames:v",
      "1",
      "-c:v",
      encoder,
      ...extraArgs,
      "-f",
      "null",
      "-",
    ];

    execFile(ffmpegPath, args, { timeout: 10000 }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Detect which hardware-backed encoder path (if any) works on this machine.
 * Order: NVIDIA NVENC → AMD AMF → Intel QSV → Apple VideoToolbox → Windows Media Foundation → none.
 */
async function detectHardwareAcceleration(ffmpegPath) {
  if (cachedCapabilities !== null) {
    return cachedCapabilities;
  }

  if (detectionPromise) {
    return detectionPromise;
  }

  const probes = [
    { vendor: "nvidia", encoder: "h264_nvenc", label: "NVIDIA NVENC" },
    { vendor: "amd", encoder: "h264_amf", label: "AMD AMF" },
    { vendor: "intel", encoder: "h264_qsv", label: "Intel QSV" },
  ];

  if (process.platform === "darwin") {
    probes.push({
      vendor: "apple",
      encoder: "h264_videotoolbox",
      label: "Apple VideoToolbox",
    });
  }

  if (process.platform === "win32") {
    probes.push({
      vendor: "mediafoundation",
      encoder: "h264_mf",
      label: "Windows Media Foundation",
      testArgs: ["-hw_encoding", "1"],
    });
  }

  detectionPromise = (async () => {
    for (const probe of probes) {
      const works = await testEncoder(
        ffmpegPath,
        probe.encoder,
        probe.testArgs,
      );
      if (works) {
        cachedCapabilities = {
          available: true,
          vendor: probe.vendor,
          label: probe.label,
          encoder: probe.encoder,
          detecting: false,
        };
        console.log(`[gpu] Hardware acceleration available: ${probe.label}`);
        return cachedCapabilities;
      }
    }

    cachedCapabilities = {
      available: false,
      vendor: null,
      label: "CPU only",
      encoder: null,
      detecting: false,
    };
    console.log("[gpu] No GPU encoders detected — using CPU codecs.");
    return cachedCapabilities;
  })();

  try {
    return await detectionPromise;
  } finally {
    detectionPromise = null;
  }
}

/** Return cached capabilities, or a transient "Detecting..." state while probing. */
function getCapabilities() {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  if (detectionPromise) {
    return {
      available: false,
      vendor: null,
      label: "Detecting...",
      encoder: null,
      detecting: true,
    };
  }

  return {
    available: false,
    vendor: null,
    label: "Detecting...",
    encoder: null,
    detecting: true,
  };
}

/** GPU-accelerated H.264 output options by vendor. */
function h264Options(vendor) {
  switch (vendor) {
    case "nvidia":
      return [
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-rc",
        "vbr",
        "-cq",
        "23",
        "-pix_fmt",
        "yuv420p",
      ];
    case "amd":
      return [
        "-c:v",
        "h264_amf",
        "-quality",
        "balanced",
        "-rc",
        "vbr_latency",
        "-pix_fmt",
        "yuv420p",
      ];
    case "intel":
      return [
        "-c:v",
        "h264_qsv",
        "-preset",
        "medium",
        "-global_quality",
        "23",
        "-pix_fmt",
        "nv12",
      ];
    case "apple":
      return ["-c:v", "h264_videotoolbox", "-pix_fmt", "yuv420p"];
    case "mediafoundation":
      return [
        "-c:v",
        "h264_mf",
        "-hw_encoding",
        "1",
        "-rate_control",
        "quality",
        "-quality",
        "75",
        "-pix_fmt",
        "nv12",
      ];
    default:
      return ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
  }
}

/** GPU-accelerated HEVC output options by vendor (used for MKV / MOV where HEVC is beneficial). */
function hevcOptions(vendor) {
  switch (vendor) {
    case "nvidia":
      return [
        "-c:v",
        "hevc_nvenc",
        "-preset",
        "p4",
        "-rc",
        "vbr",
        "-cq",
        "26",
        "-pix_fmt",
        "yuv420p",
      ];
    case "amd":
      return [
        "-c:v",
        "hevc_amf",
        "-quality",
        "balanced",
        "-rc",
        "vbr_latency",
        "-pix_fmt",
        "yuv420p",
      ];
    case "intel":
      return [
        "-c:v",
        "hevc_qsv",
        "-preset",
        "medium",
        "-global_quality",
        "26",
        "-pix_fmt",
        "nv12",
      ];
    case "apple":
      return ["-c:v", "hevc_videotoolbox", "-pix_fmt", "yuv420p"];
    case "mediafoundation":
      return [
        "-c:v",
        "hevc_mf",
        "-hw_encoding",
        "1",
        "-rate_control",
        "quality",
        "-quality",
        "70",
        "-pix_fmt",
        "nv12",
      ];
    default:
      return ["-c:v", "libx265", "-pix_fmt", "yuv420p"];
  }
}

/**
 * Build the full output-options array for a given video format, optionally
 * using GPU acceleration.
 *
 * @param {string} format        Target container (mp4, webm, mkv, mov, avi)
 * @param {boolean} useGpu       Whether GPU encoding is enabled by the user
 * @param {string|null} vendor   GPU vendor from capabilities
 * @returns {string[]}           Flat array of FFmpeg CLI tokens
 */
function getVideoOutputOptions(format, useGpu, vendor) {
  const gpuVendor = useGpu && vendor ? vendor : null;

  switch (format) {
    case "mp4":
      return [
        ...h264Options(gpuVendor),
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
      ];

    case "webm":
      // VP9 GPU encoding is Intel QSV-only and flaky — always use CPU for WebM.
      return [
        "-c:v",
        "libvpx-vp9",
        "-row-mt",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "libopus",
        "-b:a",
        "128k",
      ];

    case "mkv":
      return [...h264Options(gpuVendor), "-c:a", "aac", "-b:a", "192k"];

    case "mov":
      return [...h264Options(gpuVendor), "-c:a", "aac", "-b:a", "192k"];

    case "avi":
      return [
        "-c:v",
        "mpeg4",
        "-q:v",
        "5",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
      ];

    default:
      return [];
  }
}

module.exports = {
  detectHardwareAcceleration,
  getCapabilities,
  getVideoOutputOptions,
};
