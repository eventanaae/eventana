import type { ScreenProps } from '../App';
import { C, fredoka, PrimaryButton } from '../ui';

/**
 * Movie Night has a fixed concept, so it skips theme selection and instead
 * asks the customer to pick the film.
 *
 * This is a curated starter list of well-known, family-friendly titles. It is
 * intentionally a plain list so it can later be served from the dashboard/DB
 * and kept current (including real posters and verified streaming
 * availability) without changing the app. We deliberately do NOT claim
 * Netflix-UAE availability here — that is verified and managed by the team.
 */
interface Movie {
  id: string;
  title: string;
  age: string;
  g1: string;
  g2: string;
}

const MOVIES: Movie[] = [
  { id: 'frozen', title: 'Frozen', age: 'G', g1: '#BDEBE4', g2: '#B8C4E8' },
  { id: 'frozen2', title: 'Frozen II', age: 'PG', g1: '#B8C4E8', g2: '#7A8AC8' },
  { id: 'moana', title: 'Moana', age: 'PG', g1: '#5BCFC5', g2: '#F7C948' },
  { id: 'encanto', title: 'Encanto', age: 'PG', g1: '#F9C6DC', g2: '#F7C948' },
  { id: 'coco', title: 'Coco', age: 'PG', g1: '#F06CA8', g2: '#F7C948' },
  { id: 'toystory', title: 'Toy Story', age: 'G', g1: '#F7C948', g2: '#5BCFC5' },
  { id: 'toystory4', title: 'Toy Story 4', age: 'G', g1: '#FBD9C0', g2: '#F06CA8' },
  { id: 'nemo', title: 'Finding Nemo', age: 'G', g1: '#5BCFC5', g2: '#B8C4E8' },
  { id: 'lionking', title: 'The Lion King', age: 'PG', g1: '#F7C948', g2: '#a8752a' },
  { id: 'zootopia', title: 'Zootopia', age: 'PG', g1: '#BDEBE4', g2: '#F9C6DC' },
  { id: 'despicable', title: 'Despicable Me', age: 'PG', g1: '#F7C948', g2: '#3B3641' },
  { id: 'minions', title: 'Minions', age: 'PG', g1: '#F7C948', g2: '#F0A8B8' },
  { id: 'kungfupanda', title: 'Kung Fu Panda', age: 'PG', g1: '#F7C948', g2: '#5BCFC5' },
  { id: 'shrek', title: 'Shrek', age: 'PG', g1: '#D9F2B4', g2: '#5BCFC5' },
  { id: 'madagascar', title: 'Madagascar', age: 'PG', g1: '#F7C948', g2: '#BDEBE4' },
  { id: 'httyd', title: 'How to Train Your Dragon', age: 'PG', g1: '#B8C4E8', g2: '#3B3641' },
  { id: 'incredibles', title: 'The Incredibles', age: 'PG', g1: '#F06CA8', g2: '#F7C948' },
  { id: 'ratatouille', title: 'Ratatouille', age: 'G', g1: '#F0A8B8', g2: '#D9F2B4' },
  { id: 'paddington', title: 'Paddington', age: 'PG', g1: '#FBD9C0', g2: '#a8752a' },
  { id: 'sing', title: 'Sing', age: 'PG', g1: '#D9B8E8', g2: '#F7C948' },
];

export function MovieSelect({ draft, update, go }: ScreenProps) {
  const selected = draft.movie;

  return (
    <div style={{ animation: 'rise .35s ease', paddingBottom: 30 }}>
      <div style={{ padding: '8px 22px 0' }}>
        <button
          onClick={() => go('package')}
          style={{ background: 'none', border: 'none', color: C.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0 }}
        >
          ‹ Back
        </button>
        <div style={{ ...fredoka(24), marginTop: 8 }}>Pick your movie 🍿</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.muted, margin: '4px 0 16px', lineHeight: 1.5 }}>
          Choose the film for your cosy cinema night. Final availability is confirmed by the Eventana team.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {MOVIES.map((m) => {
            const active = selected === m.id;
            return (
              <div
                key={m.id}
                onClick={() => update({ movie: m.id })}
                style={{
                  borderRadius: 18,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: '#fff',
                  boxShadow: C.shadow,
                  border: `2.5px solid ${active ? C.pink : 'transparent'}`,
                }}
              >
                <div
                  style={{
                    height: 118,
                    background: `linear-gradient(150deg,${m.g1},${m.g2})`,
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'flex-end',
                    padding: 10,
                  }}
                >
                  <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,255,255,.9)', color: C.ink, fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>
                    {m.age}
                  </span>
                  {active && (
                    <span style={{ position: 'absolute', top: 8, left: 8, background: C.pink, color: '#fff', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                      ✓
                    </span>
                  )}
                </div>
                <div style={{ padding: '9px 11px 11px', fontSize: 12, fontWeight: 700, lineHeight: 1.25 }}>
                  {m.title}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, padding: '12px 16px', background: 'linear-gradient(transparent, rgba(255,253,250,.95) 30%)' }}>
        <PrimaryButton disabled={!selected} onClick={() => go('checkout')}>
          {selected ? 'Continue to booking' : 'Pick a movie to continue'}
        </PrimaryButton>
      </div>
    </div>
  );
}
