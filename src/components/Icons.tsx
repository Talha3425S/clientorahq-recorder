import type { ReactNode } from 'react';

const Svg = ({ children, fill }: { children: ReactNode; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Dot = () => <Svg fill><circle cx="12" cy="12" r="7" /></Svg>;
export const Pause = () => <Svg fill><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></Svg>;
export const Play = () => <Svg fill><polygon points="7,4 20,12 7,20" /></Svg>;
export const Stop = () => <Svg fill><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>;
export const Restart = () => <Svg><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></Svg>;
export const Close = () => <Svg><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const Search = () => <Svg><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Svg>;
export const Film = () => <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></Svg>;
export const Chevron = () => <Svg><path d="m6 9 6 6 6-6" /></Svg>;
export const More = () => <Svg fill><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></Svg>;
export const Lock = () => <Svg><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>;
export const VideoCam = () => <Svg><rect x="2" y="6" width="13" height="12" rx="2" /><path d="m15 10 7-4v12l-7-4z" /></Svg>;
export const Upload = () => <Svg><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v4h16v-4" /></Svg>;
export const LoomMark = () => <Svg fill><path d="M12 1.5a1.4 1.4 0 0 1 1.4 1.4v4.3l3-3a1.4 1.4 0 1 1 2 2l-3 3h4.3a1.4 1.4 0 1 1 0 2.8h-4.3l3 3a1.4 1.4 0 1 1-2 2l-3-3v4.3a1.4 1.4 0 1 1-2.8 0V14l-3 3a1.4 1.4 0 1 1-2-2l3-3H3.3a1.4 1.4 0 1 1 0-2.8h4.3l-3-3a1.4 1.4 0 0 1 2-2l3 3V2.9A1.4 1.4 0 0 1 12 1.5Z" /></Svg>;
export const SidebarToggle = () => <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16m3-10-2 2 2 2" /></Svg>;
export const UserCircle = () => <Svg><circle cx="12" cy="12" r="9" /><circle cx="12" cy="9" r="3" /><path d="M6.5 19a6 6 0 0 1 11 0" /></Svg>;
export const Calendar = () => <Svg><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Svg>;
export const Playlist = () => <Svg><rect x="3" y="4" width="14" height="16" rx="2" /><path d="m9 9 5 3-5 3zM19 7h2v13a2 2 0 0 1-2 2H7v-2" /></Svg>;
export const Clock = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const Settings = () => <Svg><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="m19.4 15 .1.1 1.1.8-1.2 2.1-1.3-.5a7.7 7.7 0 0 1-1.5.9l-.2 1.4h-2.4l-.3-1.4a7.7 7.7 0 0 1-1.6-.9l-1.3.5-1.2-2.1 1.1-.9a7 7 0 0 1 0-1.8l-1.1-.9 1.2-2.1 1.3.5a7.7 7.7 0 0 1 1.6-.9l.3-1.4h2.4l.2 1.4a7.7 7.7 0 0 1 1.5.9l1.3-.5 1.2 2.1-1.1.9a7 7 0 0 1-.1 1.8Z" /></Svg>;
export const Globe = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Svg>;
export const Invite = () => <Svg><path d="M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6m-3-3h6" /></Svg>;
export const Diamond = () => <Svg><path d="m3 9 3-5h12l3 5-9 11L3 9Z" /><path d="M3 9h18M8 4l4 16 4-16M6 4l3 5m9-5-3 5" /></Svg>;
export const Help = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.1 1.9c-1 .8-1.7 1.2-1.7 2.6M12 17h.01" /></Svg>;
export const Bell = () => <Svg><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></Svg>;
