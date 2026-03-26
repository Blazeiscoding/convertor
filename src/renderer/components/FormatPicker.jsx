export default function FormatPicker({ value, options, onChange, disabled = false }) {
  if (disabled) {
    return (
      <span className="format-pill active disabled">
        {value.toUpperCase()}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`format-pill ${opt === value ? 'active' : ''}`}
        >
          {opt.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
