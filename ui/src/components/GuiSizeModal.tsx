import React, { useState, useEffect } from "react";
import { Maximize2, Monitor, Check, X, Sliders } from "lucide-react";

interface GuiSizeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GuiSizeModal: React.FC<GuiSizeModalProps> = ({ isOpen, onClose }) => {
  const [width, setWidth] = useState<number>(1280);
  const [height, setHeight] = useState<number>(850);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch("/api/admin/gui-size")
        .then((res) => res.json())
        .then((data) => {
          if (data.width && data.height) {
            setWidth(data.width);
            setHeight(data.height);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const presets = [
    { label: "Compact Standard", w: 1280, h: 850 },
    { label: "MacBook Retina 14\"", w: 1440, h: 900 },
    { label: "MacBook Retina 16\"", w: 1600, h: 1000 },
    { label: "Full HD Widescreen", w: 1920, h: 1080 },
  ];

  const handleApply = async (targetW?: number, targetH?: number) => {
    const w = targetW || width;
    const h = targetH || height;

    if (w < 800 || h < 550) {
      setStatusMsg("Minimum dimensions are 800 x 550 px");
      return;
    }

    setSaving(true);
    setStatusMsg(null);

    try {
      const res = await fetch("/api/admin/gui-size", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: w, height: h }),
      });

      if (res.ok) {
        setWidth(w);
        setHeight(h);
        setStatusMsg("Window size updated successfully!");
        setTimeout(() => setStatusMsg(null), 2500);
      } else {
        setStatusMsg("Failed to update window size");
      }
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="size-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <div className="modal-title">
            <Sliders size={16} className="modal-title-icon" />
            <span>GUI Window Dimensions & Size Settings</span>
          </div>
          <button className="icon-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="section-group">
            <label className="section-label">Preset Dimensions</label>
            <div className="presets-grid">
              {presets.map((p) => {
                const isSelected = width === p.w && height === p.h;
                return (
                  <button
                    key={p.label}
                    type="button"
                    className={`preset-card ${isSelected ? "active" : ""}`}
                    onClick={() => handleApply(p.w, p.h)}
                  >
                    <Monitor size={16} />
                    <div className="preset-meta">
                      <span className="preset-title">{p.label}</span>
                      <span className="preset-dim">{p.w} × {p.h} px</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="section-group">
            <label className="section-label">Custom Resolution (px)</label>
            <div className="custom-row">
              <div className="field-group">
                <label className="field-sublabel">Width (px)</label>
                <input
                  type="number"
                  className="input font-mono"
                  min="800"
                  max="3840"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
              </div>

              <span className="times-sign">×</span>

              <div className="field-group">
                <label className="field-sublabel">Height (px)</label>
                <input
                  type="number"
                  className="input font-mono"
                  min="550"
                  max="2160"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                />
              </div>

              <button
                type="button"
                className="btn btn-primary apply-btn"
                onClick={() => handleApply()}
                disabled={saving}
              >
                <Check size={13} />
                <span>Apply Size</span>
              </button>
            </div>
          </div>

          {statusMsg && <div className="status-msg-banner">{statusMsg}</div>}
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1800;
        }

        .size-modal-card {
          width: 520px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .modal-top {
          padding: 12px 16px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .modal-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 700;
          font-size: 13px;
          color: var(--text-main);
        }
        .modal-title-icon { color: var(--accent-blue); }

        .icon-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
        }
        .icon-close-btn:hover { color: var(--text-main); }

        .modal-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .section-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .section-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }

        .presets-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .preset-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
          background: var(--bg-secondary);
          color: var(--text-sub);
          cursor: pointer;
          transition: all 0.12s ease;
          text-align: left;
        }
        .preset-card:hover {
          background: var(--bg-tertiary);
          color: var(--text-main);
        }
        .preset-card.active {
          border-color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.12);
          color: var(--text-main);
        }

        .preset-meta {
          display: flex;
          flex-direction: column;
        }
        .preset-title {
          font-size: 11px;
          font-weight: 600;
        }
        .preset-dim {
          font-size: 10px;
          font-family: var(--font-mono);
          color: var(--text-muted);
        }

        .custom-row {
          display: flex;
          align-items: flex-end;
          gap: 10px;
        }

        .field-group {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .field-sublabel {
          font-size: 10px;
          color: var(--text-sub);
        }

        .times-sign {
          font-size: 14px;
          color: var(--text-muted);
          padding-bottom: 6px;
        }

        .apply-btn {
          height: 32px;
          white-space: nowrap;
        }

        .status-msg-banner {
          font-size: 11px;
          color: var(--accent-green);
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.25);
          padding: 8px 12px;
          border-radius: var(--radius-sm);
          text-align: center;
        }
      `}</style>
    </div>
  );
};
