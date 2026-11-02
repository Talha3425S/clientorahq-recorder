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