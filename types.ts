export enum GameState {
  MENU,
  PLAYING,
  PAUSED,
  LEVEL_UP,
  GAME_OVER,
  VICTORY
}

export enum MapType {
  FIXED,
  INFINITE
}

export enum Rarity {
  SILVER = 'silver',
  GOLD = 'gold',
  PRISMATIC = 'prismatic'
}

export enum CardType {
  STAT,     // Passive stat boost
  ARTIFACT, // Active weapon
  BUFF,     // Modifies weapon stats
  EFFECT    // Modifies weapon logic (split, chain, etc)
}

export enum ElementType {
  PHYSICAL,
  FIRE,
  WIND,
  WATER,
  LIGHTNING
}

export interface CardDef {
  id: string;
  name: string;
  description: string;
  type: CardType;
  rarity: Rarity;
  iconColor: string;
  // Specific data depending on type
  statBonus?: {
    hpPercent?: number;
    dmgPercent?: number;
    pickupPercent?: number;
  };
  artifactConfig?: {
    cooldown: number;
    baseDamage: number;
    element: ElementType;
    projectileType: 'projectile' | 'beam' | 'area' | 'orbit' | 'lightning';
    color: number;
  };
  buffConfig?: {
    range?: number;
    speed?: number;
    frequency?: number; // Inverse cooldown
  };
  effectConfig?: {
    logic: 'split_back' | 'reverse' | 'double' | 'ignore' | 'ring' | 'fan' | 'line' | 'track' | 'copy';
    influenceCount: number; // Silver=1, Gold=2, Prismatic=3
  };
}

export interface PlayerStats {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  nextLevelXp: number;
  speed: number;
  damageMultiplier: number;
  pickupRange: number;
  inventory: CardDef[];
}

export interface EnemyDef {
  hp: number;
  damage: number;
  speed: number;
  size: number;
  color: number;
  xpValue: number;
  isBoss: boolean;
  wave: number;
}
