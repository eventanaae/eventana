import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { captureAttribution, initPixel } from './attribution';
import { initGoogleTag } from './googleTag';
import { trackVisit } from './api';

// Before React paints: read the ad parameters off the landing URL (they are
// only there on the very first request) and start the tags. The capture runs
// unconditionally — a gclid is worth banking even with no tag configured —
// while the pixel and the Google tag are no-ops without their ids.
captureAttribution();
initPixel();
initGoogleTag();
trackVisit();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
