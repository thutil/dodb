import React, { useState, useEffect, useRef } from "react";
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, Check, X } from "lucide-react";

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

  // Parse initial date
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
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
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

  const renderCalendarGrid = () => {
    const days: React.ReactNode[] = [];
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(<div key={`empty-${i}`} className="day-cell empty" />);
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
    return days;
  };

  return (
    <div className="datetime-popover" ref={popoverRef} onClick={(e) => e.stopPropagation()}>
      <div className="popover-header">
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
              <span>Time ({pad(hours)}:{pad(minutes)})</span>
            </button>
          )}
        </div>
        <button type="button" className="close-btn" onClick={onClose}>
          <X size={12} />
        </button>
      </div>

      {activeTab === "calendar" ? (
        <div className="calendar-view">
          <div className="month-selector">
            <button type="button" className="nav-btn" onClick={handlePrevMonth}>
              <ChevronLeft size={14} />
            </button>
            <span className="month-title">
              {monthNames[currentMonth]} {currentYear}
            </span>
            <button type="button" className="nav-btn" onClick={handleNextMonth}>
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="week-headers">
            <span>Su</span>
            <span>Mo</span>
            <span>Tu</span>
            <span>We</span>
            <span>Th</span>
            <span>Fr</span>
            <span>Sa</span>
          </div>

          <div className="days-grid">{renderCalendarGrid()}</div>
        </div>
      ) : (
        <div className="time-view">
          <div className="time-column">
            <span className="time-label">Hours (00-23)</span>
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
            <span className="time-label">Minutes (00-59)</span>
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

      <div className="popover-footer">
        <span className="preview-val">
          {currentYear}-{pad(currentMonth + 1)}-{pad(selectedDay)}
          {!isDateOnly && ` ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`}
        </span>
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

      <style jsx>{`
        .datetime-popover {
          position: absolute;
          top: 100%;
          left: 0;
          z-index: 2000;
          margin-top: 4px;
          width: 280px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
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
          padding: 6px 10px;
        }

        .popover-tabs {
          display: flex;
          gap: 4px;
        }

        .tab-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 4px;
          cursor: pointer;
        }
        .tab-btn.active {
          background: var(--bg-active);
          color: var(--accent-blue);
        }

        .close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          border-radius: 3px;
        }
        .close-btn:hover { color: var(--text-main); }

        .calendar-view {
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .month-selector {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .month-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-main);
        }

        .nav-btn {
          background: transparent;
          border: none;
          color: var(--text-sub);
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 4px;
        }
        .nav-btn:hover { background: var(--bg-hover); color: var(--text-main); }

        .week-headers {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          text-align: center;
          font-size: 10px;
          font-weight: 600;
          color: var(--text-muted);
        }

        .days-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 2px;
        }

        .day-cell {
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 4px;
          font-size: 11px;
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.1s ease;
        }
        .day-cell.empty { pointer-events: none; }
        .day-cell:hover { background: var(--bg-hover); }
        .day-cell.today { font-weight: 700; color: var(--accent-blue); }
        .day-cell.selected {
          background: var(--accent-blue);
          color: #fff;
          font-weight: 700;
        }

        .time-view {
          display: flex;
          height: 180px;
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
          padding: 4px;
          text-align: center;
          background: var(--bg-secondary);
        }

        .time-scroll {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }

        .time-item {
          background: transparent;
          border: none;
          padding: 4px;
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text-sub);
          cursor: pointer;
          text-align: center;
        }
        .time-item:hover { background: var(--bg-hover); color: var(--text-main); }
        .time-item.selected {
          background: var(--bg-active);
          color: var(--accent-blue);
          font-weight: 700;
        }

        .popover-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          background: var(--bg-tertiary);
          border-top: 1px solid var(--border-light);
        }

        .preview-val {
          font-size: 10px;
          font-family: var(--font-mono);
          color: var(--accent-blue);
          font-weight: 600;
        }

        .footer-actions {
          display: flex;
          gap: 6px;
        }
        .btn-sm {
          padding: 3px 8px;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
};
