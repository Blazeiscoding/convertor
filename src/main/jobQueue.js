class JobQueue {
  constructor({
    concurrency = 1,
    convertJob,
    cancelJob,
    onStatus,
    onProgress,
    onDone,
    onError
  }) {
    this.concurrency = Math.max(1, concurrency);
    this.convertJob = convertJob;
    this.cancelJobRunner = cancelJob;
    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.onDone = onDone;
    this.onError = onError;
    this.pending = [];
    this.activeJobs = new Map();
    this.cancelledJobs = new Set();
    this.draining = false;
  }

  enqueueJobs(jobs) {
    for (const job of jobs) {
      this.pending.push(job);
      this.onStatus?.({ jobId: job.jobId, status: 'queued' });
    }

    this.drain();
  }

  setConcurrency(nextConcurrency) {
    this.concurrency = Math.max(1, Math.min(4, nextConcurrency));
    this.drain();
  }

  async cancelJob(jobId) {
    if (this.activeJobs.has(jobId)) {
      this.cancelledJobs.add(jobId);
      await this.cancelJobRunner(jobId);
      return 'cancelled';
    }

    const pendingIndex = this.pending.findIndex((job) => job.jobId === jobId);

    if (pendingIndex >= 0) {
      this.pending.splice(pendingIndex, 1);
      this.cancelledJobs.add(jobId);
      this.onStatus?.({ jobId, status: 'cancelled' });
      return 'cancelled';
    }

    return 'unknown';
  }

  async dispose() {
    const activeIds = Array.from(this.activeJobs.keys());
    await Promise.all(activeIds.map((jobId) => this.cancelJob(jobId)));
  }

  async drain() {
    if (this.draining) {
      return;
    }

    this.draining = true;

    try {
      while (this.activeJobs.size < this.concurrency && this.pending.length > 0) {
        const job = this.pending.shift();

        if (!job || this.cancelledJobs.has(job.jobId)) {
          continue;
        }

        this.runJob(job);
      }
    } finally {
      this.draining = false;
    }
  }

  async runJob(job) {
    this.activeJobs.set(job.jobId, job);
    this.onStatus?.({ jobId: job.jobId, status: 'converting' });

    try {
      const result = await this.convertJob(job, {
        onProgress: (payload) => {
          this.onProgress?.({ jobId: job.jobId, ...payload });
        }
      });

      if (this.cancelledJobs.has(job.jobId)) {
        this.onStatus?.({ jobId: job.jobId, status: 'cancelled' });
      } else {
        this.onStatus?.({ jobId: job.jobId, status: 'done' });
        this.onDone?.({ jobId: job.jobId, outputPath: result.outputPath });
      }
    } catch (error) {
      const isCancelled = this.cancelledJobs.has(job.jobId) || error?.code === 'JOB_CANCELLED';

      if (isCancelled) {
        this.onStatus?.({ jobId: job.jobId, status: 'cancelled' });
      } else {
        this.onStatus?.({ jobId: job.jobId, status: 'failed' });
        this.onError?.({
          jobId: job.jobId,
          message: error instanceof Error ? error.message : 'Unknown conversion error.'
        });
      }
    } finally {
      this.activeJobs.delete(job.jobId);
      this.cancelledJobs.delete(job.jobId);
      this.drain();
    }
  }
}

module.exports = {
  JobQueue
};
