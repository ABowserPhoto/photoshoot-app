"use client";

type RadianceHdrSettings = {
  shadow_amount: number;
  highlight_amount: number;
  shadow_tone: number;
  highlight_tone: number;
  color_correction: number;
  local_contrast: number;
  creative_white_scale: number;
  exposure_adjust: number;
  gamut_compress: number;
};

type RadianceControlConfig = {
  key: keyof RadianceHdrSettings;
  label: string;
  min: number;
  max: number;
  step: number;
};

const CONTROLS: RadianceControlConfig[] = [
  { key: "shadow_amount", label: "Shadow Amount", min: 0, max: 1, step: 0.01 },
  { key: "highlight_amount", label: "Highlight Amount", min: 0, max: 1, step: 0.01 },
  { key: "shadow_tone", label: "Shadow Tone", min: 0, max: 1, step: 0.01 },
  { key: "highlight_tone", label: "Highlight Tone", min: 0, max: 1, step: 0.01 },
  { key: "color_correction", label: "Color Correction", min: 0, max: 1, step: 0.01 },
  { key: "local_contrast", label: "Local Contrast", min: -1, max: 1, step: 0.01 },
  { key: "creative_white_scale", label: "Creative White Scale", min: 0.5, max: 2, step: 0.01 },
  { key: "exposure_adjust", label: "Exposure Adjust", min: -4, max: 4, step: 0.05 },
  { key: "gamut_compress", label: "Gamut Compress", min: 0, max: 2, step: 0.01 },
];

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export const DEFAULT_RADIANCE_HDR_SETTINGS: RadianceHdrSettings = {
  shadow_amount: 0.5,
  highlight_amount: 0.5,
  shadow_tone: 0.25,
  highlight_tone: 0.75,
  color_correction: 0.5,
  local_contrast: 0,
  creative_white_scale: 1,
  exposure_adjust: 0,
  gamut_compress: 1,
};

export type { RadianceHdrSettings };

type RadianceHDRPanelProps = {
  settings: RadianceHdrSettings;
  onChange: (next: RadianceHdrSettings) => void;
};

export default function RadianceHDRPanel({ settings, onChange }: RadianceHDRPanelProps) {
  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_RADIANCE_HDR_SETTINGS })}
          className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Reset to Defaults
        </button>
      </div>
      {CONTROLS.map((control) => {
        const value = settings[control.key];
        return (
          <div key={control.key} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-300">
              <span>{control.label}</span>
              <span>{value.toFixed(control.step < 0.1 ? 2 : 1)}</span>
            </div>
            <div className="grid grid-cols-[1fr_92px] items-center gap-2">
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={value}
                onChange={(event) => {
                  const nextValue = clampValue(Number(event.target.value), control.min, control.max);
                  onChange({ ...settings, [control.key]: nextValue });
                }}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-300 dark:bg-zinc-700"
              />
              <input
                type="number"
                min={control.min}
                max={control.max}
                step={control.step}
                value={value}
                onChange={(event) => {
                  const nextValue = clampValue(Number(event.target.value), control.min, control.max);
                  onChange({ ...settings, [control.key]: nextValue });
                }}
                className="h-9 w-full rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
