// CPU play styles. Every CPU team has one; they bend how the AI chooses between passing, lobbing, shooting and tackling,
// and which formation and pressing it starts with. A human team plays "balanced" (its mates follow the chosen tactics).
//   forward   weight of forward progress when picking a pass target (1 = normal)
//   distance  how much a long pass is penalised (high = short passes, low = long balls)
//   passFree / passPressed   chance to pass instead of dribbling, when free / when closed down
//   lob       multiplier on lobbed passes and crosses; shoot  multiplier on the shooting range
//   tackle    multiplier on slide-tackle attempts; speed  pace multiplier
//   tag / press   preferred formation shape and pressing (null = decided by the team rating)
export const STYLES = {
  balanced: { key: 'balanced', label: 'Balanced', desc: 'No special approach: a normal mix of everything.', tag: null, press: null, forward: 1, distance: 1, passFree: 0.25, passPressed: 0.75, lob: 1, shoot: 1, tackle: 1, speed: 1 },
  possession: { key: 'possession', label: 'Possession', desc: 'Short passes and patient build-up; shoots only from close.', tag: 'diamond', press: 'balanced', forward: 0.5, distance: 2.2, passFree: 0.6, passPressed: 0.85, lob: 0.35, shoot: 0.85, tackle: 0.9, speed: 1 },
  counter: { key: 'counter', label: 'Counter-attack', desc: 'Sits deep, wins the ball and breaks quickly with direct passes.', tag: 'park', press: 'low', forward: 1.8, distance: 0.7, passFree: 0.3, passPressed: 0.85, lob: 1.3, shoot: 1.1, tackle: 0.85, speed: 1.03 },
  longball: { key: 'longball', label: 'Long ball', desc: 'Big switches and lobs towards the strikers.', tag: 'attack', press: 'low', forward: 1.6, distance: 0.25, passFree: 0.3, passPressed: 0.6, lob: 2.4, shoot: 1.1, tackle: 1, speed: 1 },
  press: { key: 'press', label: 'High press', desc: 'Hunts the ball high up the pitch: tiring, but aggressive.', tag: 'balanced', press: 'high', forward: 1.1, distance: 1, passFree: 0.25, passPressed: 0.75, lob: 0.9, shoot: 1, tackle: 1.25, speed: 1.02 },
};
export const STYLE_KEYS = Object.keys(STYLES);
export const styleByKey = (key) => STYLES[key] || STYLES.balanced;
