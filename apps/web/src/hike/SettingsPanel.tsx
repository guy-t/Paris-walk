/**
 * Settings. Five of them, because a walking app that needs configuring has
 * already failed — these are the ones that genuinely differ between people
 * (how fast you walk) or between hikes (how far off the path is "off").
 */

import { providersFor, store, type AnyPoint } from "@slownav/core";
import { useMemo, useState } from "react";
import { DEFAULT_SETTINGS, type HikeSettings } from "./model.js";
import { backgroundTrackingAvailable } from "../shared/geolocation.js";

export interface SettingsPanelProps {
  settings: HikeSettings;
  onSave: (s: HikeSettings) => void;
  onClose: () => void;
  /** A point on the current route, used to say which maps reach it. */
  near?: AnyPoint | null;
}

export function SettingsPanel({ settings, onSave, onClose, near }: SettingsPanelProps) {
  const [draft, setDraft] = useState<HikeSettings>(settings);
  const set = <K extends keyof HikeSettings>(k: K, v: HikeSettings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const options = useMemo(() => providersFor(near ?? [43.15, -4.75]), [near]);
  const chosen = options.find((o) => o.provider.id === draft.provider)?.provider;
  const [mapKey, setMapKey] = useState(
    () => store.get<string>("map:key:" + (chosen?.keyName ?? "none")) ?? "",
  );

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
          Base map
          <select value={draft.provider} onChange={(e) => set("provider", e.target.value)}>
            {options.map(({ provider, available }) => (
              <option key={provider.id} value={provider.id} disabled={!available}>
                {provider.name}
                {available ? "" : " — not this area"}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{chosen?.note}</p>

        {chosen?.keyName && (
          <>
            <label>
              {chosen.name} key
              <input
                type="text"
                value={mapKey}
                placeholder="paste your API key"
                onChange={(e) => setMapKey(e.target.value)}
              />
            </label>
            <p className="hint">
              Kept on this device only, never sent anywhere but the map server, and never
              stored in the project.
            </p>
          </>
        )}

        <label>
          Show sights on the map
          <input
            type="checkbox"
            checked={draft.showSights}
            onChange={(e) => set("showSights", e.target.checked)}
          />
        </label>
        <p className="hint">
          Turning these off leaves the list in the sheet untouched — it only stops the dots
          covering the map.
        </p>

        <label>
          Start GPS when a hike is opened
          <input
            type="checkbox"
            checked={draft.gpsOnOpen}
            onChange={(e) => set("gpsOnOpen", e.target.checked)}
          />
        </label>
        <p className="hint">
          The map still opens showing the whole route rather than jumping to you — tap the
          arrow to follow.
        </p>

        {/* Only where it can actually be done. On a phone without the shell,
            or in a browser, a switch that promised this would be a lie: a
            hidden page is given no fixes by any browser. */}
        {backgroundTrackingAvailable() && (
          <>
            <label>
              Keep recording with the screen off
              <input
                type="checkbox"
                checked={draft.bgGps}
                onChange={(e) => set("bgGps", e.target.checked)}
              />
            </label>
            <p className="hint">
              Off, the trail has gaps whenever the phone is in a pocket — your place on the
              route, distance and ETA all recover on the first fix when you wake it, but the
              line does not. On, a notification stays up while the walk records and the GPS
              keeps running, which costs noticeably more battery over a day.
            </p>
          </>
        )}

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
        <button
          className="primary"
          onClick={() => {
            // The key belongs to the device, not to the settings object that
            // gets written to storage alongside everything else.
            if (chosen?.keyName) store.set("map:key:" + chosen.keyName, mapKey.trim());
            onSave(draft);
          }}
        >
          Save
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
