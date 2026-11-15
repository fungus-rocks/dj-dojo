import flx4 from './ddj-flx4.js';

// Add new controller profiles here.
export const PROFILES = [flx4];

export const findProfile = (portName) => PROFILES.find((p) => p.match.test(portName || ''));
