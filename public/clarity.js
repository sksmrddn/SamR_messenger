// TEST ONLY: Microsoft Clarity for bug recordings.
// Before launch: delete this file and the <script src="/clarity.js"> line in index.html, and restore the LIVE line in _headers.
// Clarity project ID is set below.
const CLARITY_ID = 'z01l85xl9c';
// Wait until the page has finished loading, so the one-time link secret has already been
// removed from the address bar by app.js and never reaches the recording.
document.addEventListener('DOMContentLoaded', () => {
  if (!CLARITY_ID || CLARITY_ID === 'YOUR_CLARITY_ID') return;
  window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
  const s = document.createElement('script');
  s.async = true; s.src = 'https://www.clarity.ms/tag/' + encodeURIComponent(CLARITY_ID);
  document.head.appendChild(s);
});
