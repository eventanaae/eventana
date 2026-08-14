import { useState } from 'react';
import type { Profile } from '../profile';
import { C, fredoka, Field, PrimaryButton } from '../ui';

/**
 * First-run welcome. Asks only for a name and a birthday, then hands the
 * profile back to App to store. Deliberately minimal — no password, no
 * account step.
 */
export function Onboarding({ onDone }: { onDone: (p: Profile) => void }) {
  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState('');
  const ready = name.trim().length >= 2 && Boolean(birthday);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '34px 26px 28px',
        animation: 'rise .35s ease',
      }}
    >
      <div style={{ fontFamily: "'Sacramento', cursive", fontSize: 30, color: C.pinkDeep, lineHeight: 1 }}>
        Welcome to Eventana
      </div>
      <div style={{ ...fredoka(25), lineHeight: 1.2, marginTop: 8 }}>Let’s get to know you ✨</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, margin: '10px 0 28px', lineHeight: 1.6 }}>
        Just your name and birthday — so your celebrations feel personal, and
        we can wish you on your special day 🎂
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Your name</div>
      <Field placeholder="e.g. Sara" value={name} onChange={setName} style={{ marginBottom: 18 }} />

      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Your birthday</div>
      <input
        type="date"
        value={birthday}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => setBirthday(e.target.value)}
        style={{
          border: `1px solid ${C.pinkLine}`,
          borderRadius: 14,
          padding: '12px 14px',
          fontWeight: 600,
          fontSize: 12.5,
          background: '#fff',
          color: C.ink,
          outline: 'none',
          width: '100%',
        }}
      />

      <div style={{ flex: 1, minHeight: 24 }} />
      <PrimaryButton onClick={() => onDone({ name: name.trim(), birthday })} disabled={!ready}>
        Start celebrating 🎉
      </PrimaryButton>
    </div>
  );
}
