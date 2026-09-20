/**
 * Settings. Five of them, because a walking app that needs configuring has
 * already failed — these are the ones that genuinely differ between people
 * (how fast you walk) or between hikes (how far off the path is "off").
 */
import { type HikeSettings } from "./model.js";
export interface SettingsPanelProps {
    settings: HikeSettings;
    onSave: (s: HikeSettings) => void;
    onClose: () => void;
}
export declare function SettingsPanel({ settings, onSave, onClose }: SettingsPanelProps): import("react").JSX.Element;
//# sourceMappingURL=SettingsPanel.d.ts.map