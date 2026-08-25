import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { captureAttribution, initPixel } from './attribution';

// Before React paints: read the ad parameters off the landing URL (they are
// only there on the very first request) and start the pixel. Both are no-ops
// without VITE_META_PIXEL_ID.
captureAttribution();
initPixel();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
