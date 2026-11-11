// Small, consistent line icons for the header and its labelled menu.
const paths = {
  learn: '<path d="m2 8 10-5 10 5-10 5Zm4 2v7c4 3 8 3 12 0v-7M22 8v9"/>',
  company: '<path d="m3 14 8-3V4a1 1 0 0 1 2 0v7l8 3v2l-8-1v4l3 2H8l3-2v-4l-8 1Z"/>',
  operations: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  finance: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M16 10h5v5h-5a2.5 2.5 0 0 1 0-5Z"/><path d="M6 5V3h12"/>',
  contracts: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m8 13 2 2 5-5M8 18h8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h3m3 0h3"/>',
  rivals: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 2 4v3"/>',
  goals: '<path d="M8 3h8v6a4 4 0 0 1-8 0Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v5m-4 3h8m-7-3h6"/>',
  log: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
};
export const icon = (name) => `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.more}</svg>`;
