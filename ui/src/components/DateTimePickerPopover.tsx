import React, { useState, useEffect, useRef } from "react";
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, Check, X, Sparkles } from "lucide-react";

interface DateTimePickerPopoverProps {
  value: string;
  type?: string; // "date", "datetime", "timestamp", etc.
  onChange: (newValue: string) => void;
  onClose: () => void;
}

export const DateTimePickerPopover: React.FC<DateTimePickerPopoverProps> = ({
  value,
  type = "datetime",
  onChange,
  onClose,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const isDateOnly = type.toLowerCase() === "date";

  // Parse initial date safely
  const parseInitialDate = () => {
    if (!value) return new Date();
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  };

  const initialDate = parseInitialDate();

  const [currentYear, setCurrentYear] = useState<number>(initialDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(initialDate.getMonth()); // 0 - 11
  const [selectedDay, setSelectedDay] = useState<number>(initialDate.getDate());
  const [hours, setHours] = useState<number>(initialDate.getHours());
  const [minutes, setMinutes] = useState<number>(initialDate.getMinutes());
  const [seconds, setSeconds] = useState<number>(initialDate.getSeconds());
  const [activeTab, setActiveTab] = useState<"calendar" | "time">("calendar");

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

  // Quick Preset Handlers
  const applyPresetToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setSelectedDay(now.getDate());
  };

  const applyPresetNow = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setSelectedDay(now.getDate());
    setHours(now.getHours());
    setMinutes(now.getMinutes());
    setSeconds(now.getSeconds());
  };

  const handleConfirm = () => {
    const yyyy = currentYear;
    const mm = pad(currentMonth + 1);
    const dd = pad(selectedDay);
    if (isDateOnly) {
      onChange(`${yyyy}-${mm}-${dd}`);
    } else {
      const hh = pad(hours);
      const min = pad(minutes);
      const ss = pad(seconds);
      onChange(`${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`);
    }
    onClose();
  };

  const handleClear = () => {
    onChange("");
    onClose();
  };

  const yearsRange = Array.from({ length: 30 }, (_, i) => new Date().getFullYear() - 15 + i);

  const renderCalendarGrid = () => {
    const days: React.ReactNode[] = [];
    // Prev month padding
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      days.push(
        <div key={`prev-${i}`} className="day-cell muted">
          {prevMonthDays - i}
        </div>
      );
    }

    const today = new Date();
    const isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() === currentMonth;

    for (let day = 1; day <= daysInMonth; day++) {
      const isSelected = day === selectedDay;
      const isToday = isCurrentMonth && day === today.getDate();

      days.push(
        <button
          key={`day-${day}`}
          type="button"
          className={`day-cell ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`}
          onClick={() => setSelectedDay(day)}
        >
          {day}
        </button>
      );
    }

    // Next month padding
    const totalCells = days.length;
    const remaining = 35 - totalCells > 0 ? 35 - totalCells : 42 - totalCells;
    for (let i = 1; i <= remaining; i++) {
      days.push(
        <div key={`next-${i}`} className="day-cell muted">
          {i}
        </div>
      );
    }

    return days;
  };

  return (
    <div className="datetime-modal-overlay" onClick={onClose}>
      <div className="datetime-popover" ref={popoverRef} onClick={(e) => e.stopPropagation()}>
        {/* Header Bar */}
        <div className="popover-header">
          <div className="popover-title-badge">
            <Sparkles size={13} className="sparkle-icon" />
            <span>{isDateOnly ? "Date Picker" : "Date & Time Picker"}</span>
          </div>

          <div className="popover-tabs">
            <button
              type="button"
              className={`tab-btn ${activeTab === "calendar" ? "active" : ""}`}
              onClick={() => setActiveTab("calendar")}
            >
              <CalendarIcon size={12} />
              <span>Date</span>
            </button>
            {!isDateOnly && (
              <button
                type="button"
                className={`tab-btn ${activeTab === "time" ? "active" : ""}`}
                onClick={() => setActiveTab("time")}
              >
                <Clock size={12} />
                <span>{pad(hours)}:{pad(minutes)}:{pad(seconds)}</span>
              </button>
            )}
            <button type="button" className="close-btn" onClick={onClose}>
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Quick Presets Bar */}
        <div className="presets-bar">
          <button type="button" className="preset-chip" onClick={applyPresetToday}>
            Today
          </button>
          {!isDateOnly && (
            <button type="button" className="preset-chip highlight" onClick={applyPresetNow}>
              Now (Current Time)
            </button>
          )}
          <button type="button" className="preset-chip clear" onClick={handleClear}>
            NULL / Clear
          </button>
        </div>

        {activeTab === "calendar" ? (
          <div className="calendar-view">
            {/* Month & Year Selectors */}
            <div className="month-year-bar">
              <button type="button" className="nav-btn" onClick={handlePrevMonth} title="Previous Month">
                <ChevronLeft size={14} />
              </button>

              <div className="select-group">
                <select
                  className="month-select"
                  value={currentMonth}
                  onChange={(e) => setCurrentMonth(Number(e.target.value))}
                >
                  {monthNames.map((m, idx) => (
                    <option key={m} value={idx}>
                      {m}
                    </option>
                  ))}
                </select>

                <select
                  className="year-select"
                  value={currentYear}
                  onChange={(e) => setCurrentYear(Number(e.target.value))}
                >
                  {yearsRange.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <button type="button" className="nav-btn" onClick={handleNextMonth} title="Next Month">
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Week Headers */}
            <div className="week-headers">
              <span>Su</span>
              <span>Mo</span>
              <span>Tu</span>
              <span>We</span>
              <span>Th</span>
              <span>Fr</span>
              <span>Sa</span>
            </div>

            {/* Days Grid */}
            <div className="days-grid">{renderCalendarGrid()}</div>
          </div>
        ) : (
          <div className="time-view">
            <div className="time-column">
              <span className="time-label">Hour (00-23)</span>
              <div className="time-scroll">
                {Array.from({ length: 24 }).map((_, h) => (
                  <button
                    key={`h-${h}`}
                    type="button"
                    className={`time-item ${hours === h ? "selected" : ""}`}
                    onClick={() => setHours(h)}
                  >
                    {pad(h)}
                  </button>
                ))}
              </div>
            </div>

            <div className="time-column">
              <span className="time-label">Min (00-59)</span>
              <div className="time-scroll">
                {Array.from({ length: 60 }).map((_, m) => (
                  <button
                    key={`m-${m}`}
                    type="button"
                    className={`time-item ${minutes === m ? "selected" : ""}`}
                    onClick={() => setMinutes(m)}
                  >
                    {pad(m)}
                  </button>
                ))}
              </div>
            </div>

            <div className="time-column">
              <span className="time-label">Sec (00-59)</span>
              <div className="time-scroll">
                {Array.from({ length: 60 }).map((_, s) => (
                  <button
                    key={`s-${s}`}
                    type="button"
                    className={`time-item ${seconds === s ? "selected" : ""}`}
                    onClick={() => setSeconds(s)}
                  >
                    {pad(s)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="popover-footer">
          <div className="preview-val font-mono">
            {currentYear}-{pad(currentMonth + 1)}-{pad(selectedDay)}
            {!isDateOnly && ` ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`}
          </div>

          <div className="footer-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleConfirm}>
              <Check size={12} />
              <span>Apply</span>
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .datetime-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 3000;
          background: rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(5px);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.15s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }

        .datetime-popover {
          width: 320px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: 12px;
          box-shadow: 0 20px 45px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          font-family: inherit;
        }

        .popover-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          padding: 8px 12px;
        }

        .popover-title-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          color: var(--accent-blue);
        }

        .sparkle-icon { color: var(--accent-blue); }

        .popover-tabs {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .tab-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tab-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }

        .tab-btn.active {
          background: var(--accent-blue);
          color: #ffffff;
          font-weight: 600;
        }

        .close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 3px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-left: 4px;
        }
        .close-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }

        .presets-bar {
          display: flex;
          gap: 6px;
          padding: 8px 12px;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-light);
          overflow-x: auto;
        }

        .preset-chip {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-sub);
          font-size: 10px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 12px;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s ease;
        }

        .preset-chip:hover {
          background: var(--bg-hover);
          color: var(--text-main);
          border-color: var(--accent-blue);
        }

        .preset-chip.highlight {
          color: var(--accent-blue);
          border-color: rgba(59, 130, 246, 0.4);
          background: rgba(59, 130, 246, 0.1);
        }

        .preset-chip.clear {
          color: var(--accent-red);
          border-color: rgba(239, 68, 68, 0.3);
        }

        .calendar-view {
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .month-year-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .select-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .month-select, .year-select {
          background: var(--bg-secondary);
          color: var(--text-main);
          border: 1px solid var(--border-light);
          border-radius: 6px;
          padding: 3px 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          outline: none;
        }

        .month-select:hover, .year-select:hover {
          border-color: var(--accent-blue);
        }

        .nav-btn {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          color: var(--text-sub);
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .nav-btn:hover {
          background: var(--bg-hover);
          color: var(--text-main);
          border-color: var(--accent-blue);
        }

        .week-headers {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          text-align: center;
          font-size: 10px;
          font-weight: 700;
          color: var(--text-muted);
          padding: 4px 0;
        }

        .days-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 3px;
        }

        .day-cell {
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .day-cell.muted {
          color: var(--text-muted);
          opacity: 0.4;
          cursor: default;
        }

        .day-cell:hover:not(.muted) {
          background: var(--bg-hover);
          border-color: var(--border-light);
        }

        .day-cell.today {
          font-weight: 700;
          color: var(--accent-blue);
          border-color: rgba(59, 130, 246, 0.4);
        }

        .day-cell.selected {
          background: var(--accent-blue) !important;
          color: #ffffff !important;
          font-weight: 700;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
        }

        .time-view {
          display: flex;
          height: 200px;
          border-bottom: 1px solid var(--border-light);
        }

        .time-column {
          flex: 1;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border-light);
        }
        .time-column:last-child { border-right: none; }

        .time-label {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 6px;
          text-align: center;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-light);
        }

        .time-scroll {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          padding: 4px 2px;
        }

        .time-item {
          background: transparent;
          border: none;
          padding: 5px 0;
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text-sub);
          cursor: pointer;
          text-align: center;
          border-radius: 4px;
          transition: all 0.1s ease;
        }

        .time-item:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }

        .time-item.selected {
          background: var(--accent-blue);
          color: #ffffff;
          font-weight: 700;
        }

        .popover-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--bg-tertiary);
          border-top: 1px solid var(--border-light);
        }

        .preview-val {
          font-size: 10px;
          color: var(--accent-blue);
          font-weight: 700;
          background: rgba(59, 130, 246, 0.1);
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid rgba(59, 130, 246, 0.2);
        }

        .footer-actions {
          display: flex;
          gap: 6px;
        }
      `}</style>
    </div>
  );
};

