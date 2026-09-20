/**
 * Settings. Five of them, because a walking app that needs configuring has
 * already failed — these are the ones that genuinely differ between people
 * (how fast you walk) or between hikes (how far off the path is "off").
 */

import { useState } from "react";
import { DEFAULT_SETTINGS, type HikeSettings } from "./model.js";

export interface SettingsPanelProps {
  settings: HikeSettings;
  onSave: (s: HikeSettings) => void;
  onClose: () => void;
}

export function SettingsPanel({ settings, onSave, onClose }: SettingsPanelProps) {
  const [draft, setDraft] = useState<HikeSettings>(settings);
  const set = <K extends keyof HikeSettings>(k: K, v: HikeSettings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="panel" id="settings">
      <div className="panel-head">
        <h2>Settings</h2>
        <button className="close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="panel-body set-body">
        <label>
          Units
          <select
            value={draft.units}
            onChange={(e) => set("units", e.target.value as HikeSettings["units"])}
          >
            <option value="metric">Metric (km, m)</option>
            <option value="imperial">Imperial (mi, ft)</option>
          </select>
        </label>

        <label>
          Pace on the flat (km/h)
          <input
            type="number"
            min={2}
            max={8}
            step={0.5}
            value={draft.pace}
            onChange={(e) => set("pace", +e.target.value || DEFAULT_SETTINGS.pace)}
          />
        </label>
        <p className="hint">
          Every time estimate is scaled to this, then adjusted to how you are actually walking
          once you are twenty minutes in.
        </p>

        <label>
          Off-track warning (m)
          <input
            type="number"
            min={15}
            max={300}
            step={5}
            value={draft.off}
            onChange={(e) => set("off", +e.target.value || DEFAULT_SETTINGS.off)}
          />
        </label>
        <p className="hint">
          How far from the line counts as off it. Lower on a clear path, higher on open ground
          where the mapped line is a suggestion.
        </p>

        <label>
          Buzz when off track
          <input type="checkbox" checked={draft.vib} onChange={(e) => set("vib", e.target.checked)} />
        </label>

        <label>
          Warn when the ETA is after sunset
          <input type="checkbox" checked={draft.sun} onChange={(e) => set("sun", e.target.checked)} />
        </label>
      </div>

      <div className="panel-foot">
        <button className="primary" onClick={() => onSave(draft)}>
          Save
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
