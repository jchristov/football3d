// Full-screen icons: four corner brackets pointing outwards (enter full screen) or inwards (leave it)
const svg = (d) => `<svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
export const FS_ENTER = svg('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5');
export const FS_EXIT = svg('M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5');
