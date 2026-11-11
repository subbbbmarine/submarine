import fogBeam from './cards/fog-beam.webp';
import fogBeamThumb from './cards/fog-beam-thumb.webp';
import moon from './cards/moon.webp';
import moonThumb from './cards/moon-thumb.webp';
import neonStreet from './cards/neon-street.webp';
import neonStreetThumb from './cards/neon-street-thumb.webp';
import nightDrive from './cards/night-drive.webp';
import nightDriveThumb from './cards/night-drive-thumb.webp';
import redAlley from './cards/red-alley.webp';
import redAlleyThumb from './cards/red-alley-thumb.webp';
import redLightning from './cards/red-lightning.webp';
import redLightningThumb from './cards/red-lightning-thumb.webp';
import rocket from './cards/rocket.webp';
import rocketThumb from './cards/rocket-thumb.webp';
import skyline from './cards/skyline.webp';
import skylineThumb from './cards/skyline-thumb.webp';
import stars from './cards/stars.webp';
import starsThumb from './cards/stars-thumb.webp';
import tailLights from './cards/tail-lights.webp';
import tailLightsThumb from './cards/tail-lights-thumb.webp';

/** Photos for the share card, free under the Unsplash License, see docs/card-photos. The last two suit a trade that lost money. */
export interface Backdrop {
  id: string;
  name: string;
  src: string;
  thumb: string;
  mood: 'up' | 'down';
}

export const BACKDROPS: Backdrop[] = [
  { id: 'neon-street', name: 'Neon street', src: neonStreet.src, thumb: neonStreetThumb.src, mood: 'up' },
  { id: 'tail-lights', name: 'Tail lights', src: tailLights.src, thumb: tailLightsThumb.src, mood: 'up' },
  { id: 'night-drive', name: 'Night drive', src: nightDrive.src, thumb: nightDriveThumb.src, mood: 'up' },
  { id: 'fog-beam', name: 'Headlights in fog', src: fogBeam.src, thumb: fogBeamThumb.src, mood: 'up' },
  { id: 'skyline', name: 'Skyline', src: skyline.src, thumb: skylineThumb.src, mood: 'up' },
  { id: 'moon', name: 'Moon', src: moon.src, thumb: moonThumb.src, mood: 'up' },
  { id: 'rocket', name: 'Rocket', src: rocket.src, thumb: rocketThumb.src, mood: 'up' },
  { id: 'stars', name: 'Under the stars', src: stars.src, thumb: starsThumb.src, mood: 'up' },
  { id: 'red-lightning', name: 'Red lightning', src: redLightning.src, thumb: redLightningThumb.src, mood: 'down' },
  { id: 'red-alley', name: 'Dark alley', src: redAlley.src, thumb: redAlleyThumb.src, mood: 'down' },
];

/** Which photo a trade gets unless you choose: one that fits how it went, the same one each time for the same token. */
export function backdropFor(token: string, profit: number): Backdrop {
  const set = BACKDROPS.filter((b) => b.mood === (profit >= 0 ? 'up' : 'down'));
  let hash = 0;
  for (const c of token) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return set[hash % set.length]!;
}
