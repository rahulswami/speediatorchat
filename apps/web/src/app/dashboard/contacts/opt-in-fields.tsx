'use client';

interface Props {
  optedIn: boolean;
  source: string;
  countryCode: string;
  onChange: (next: { optedIn?: boolean; source?: string; countryCode?: string }) => void;
  consentLabel: string;
}

export function OptInFields({ optedIn, source, countryCode, onChange, consentLabel }: Props) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium mb-1">Default country code</label>
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground">+</span>
          <input
            required
            value={countryCode}
            onChange={(e) => onChange({ countryCode: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            className="w-20 border rounded-md px-3 py-2 text-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Added to 10-digit numbers that have no country code.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={optedIn}
          onChange={(e) => onChange({ optedIn: e.target.checked })}
          className="mt-0.5"
        />
        <span>{consentLabel}</span>
      </label>

      {optedIn && (
        <div>
          <label className="block text-sm font-medium mb-1">Where did they agree?</label>
          <input
            required
            value={source}
            onChange={(e) => onChange({ source: e.target.value })}
            placeholder="e.g. Website form, in-store sign-up sheet"
            className="w-full border rounded-md px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Saved with the opt-in date. WhatsApp only allows marketing messages to people who agreed.
          </p>
        </div>
      )}
    </>
  );
}
