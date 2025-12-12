
import { CardDef, CardType, ElementType, Rarity } from './types';

export const SCREEN_WIDTH = window.innerWidth;
export const SCREEN_HEIGHT = window.innerHeight;

export const COLORS = {
  UI_BG: '#1a1a2e',
  UI_BORDER: '#4ecca3',
  HP_BAR: '#e94560',
  XP_BAR: '#ffd700',
  TEXT: '#ffffff',
  RARITY_SILVER: '#e2e8f0', // Slate-200
  RARITY_GOLD: '#fbbf24',   // Amber-400
  RARITY_PRISMATIC: '#d946ef', // Fuchsia-500
  
  // XP Orb Colors
  XP_GRAY: 0x9ca3af,
  XP_GREEN: 0x4ade80,
  XP_BLUE: 0x60a5fa,
  XP_ORANGE: 0xfb923c,
  XP_RED: 0xf87171,
  XP_PRISM: 0xd946ef
};

// --- Card Definitions ---

const generateId = () => Math.random().toString(36).substr(2, 9);

// 1. Stats
export const STAT_CARDS: CardDef[] = [
  { id: 'hp_s', name: '生命增强', description: '生命值 +20%', type: CardType.STAT, rarity: Rarity.SILVER, iconColor: COLORS.RARITY_SILVER, statBonus: { hpPercent: 0.2 } },
  { id: 'hp_g', name: '生命增强 II', description: '生命值 +60%', type: CardType.STAT, rarity: Rarity.GOLD, iconColor: COLORS.RARITY_GOLD, statBonus: { hpPercent: 0.6 } },
  { id: 'hp_p', name: '不灭金身', description: '生命值 +120%', type: CardType.STAT, rarity: Rarity.PRISMATIC, iconColor: COLORS.RARITY_PRISMATIC, statBonus: { hpPercent: 1.2 } },
  { id: 'dmg_s', name: '力量增强', description: '伤害 +20%', type: CardType.STAT, rarity: Rarity.SILVER, iconColor: COLORS.RARITY_SILVER, statBonus: { dmgPercent: 0.2 } },
  { id: 'dmg_g', name: '力量增强 II', description: '伤害 +60%', type: CardType.STAT, rarity: Rarity.GOLD, iconColor: COLORS.RARITY_GOLD, statBonus: { dmgPercent: 0.6 } },
  { id: 'dmg_p', name: '修罗之力', description: '伤害 +120%', type: CardType.STAT, rarity: Rarity.PRISMATIC, iconColor: COLORS.RARITY_PRISMATIC, statBonus: { dmgPercent: 1.2 } },
];

// 2. Artifacts (Weapons)
export const ARTIFACT_CARDS: CardDef[] = [
  { 
    id: 'art_fire', name: '火葫芦', description: '喷射等离子烈焰 (受范围影响)', 
    type: CardType.ARTIFACT, rarity: Rarity.GOLD, iconColor: '#ff4500', 
    artifactConfig: { cooldown: 20, baseDamage: 4, element: ElementType.FIRE, projectileType: 'area', color: 0xff4500 }
  },
  { 
    id: 'art_wind', name: '风囊', description: '吹飞敌人的风暴 (受数量/范围影响)', 
    type: CardType.ARTIFACT, rarity: Rarity.SILVER, iconColor: '#88ff88', 
    artifactConfig: { cooldown: 180, baseDamage: 1, element: ElementType.WIND, projectileType: 'area', color: 0xccffcc }
  },
  { 
    id: 'art_water', name: '白玉神盂', description: '倾倒出蜿蜒的河流', 
    type: CardType.ARTIFACT, rarity: Rarity.GOLD, iconColor: '#00bfff', 
    artifactConfig: { cooldown: 15, baseDamage: 4, element: ElementType.WATER, projectileType: 'water_snake', color: 0x00bfff }
  },
  { 
    id: 'art_pull', name: '碧玉瑶光如意', description: '全屏闪烁，强力吸附所有经验', 
    type: CardType.ARTIFACT, rarity: Rarity.PRISMATIC, iconColor: '#ff00ff', 
    artifactConfig: { cooldown: 600, baseDamage: 0, element: ElementType.PHYSICAL, projectileType: 'pull_screen', color: 0xff00ff }
  },
  { 
    id: 'art_track', name: '三尖两刃刀', description: '显化二郎真君神兵，自动斩妖', 
    type: CardType.ARTIFACT, rarity: Rarity.GOLD, iconColor: '#dddddd', 
    artifactConfig: { cooldown: 30, baseDamage: 20, element: ElementType.PHYSICAL, projectileType: 'minion', color: 0xcccccc }
  },
  // Blue Lightning
  { 
    id: 'art_wedge', name: '雷公楔', description: '蓝色闪电 (与黄色闪电交叉引发雷暴)', 
    type: CardType.ARTIFACT, rarity: Rarity.GOLD, iconColor: '#00ffff', 
    artifactConfig: { cooldown: 45, baseDamage: 25, element: ElementType.LIGHTNING_BLUE, projectileType: 'lightning', color: 0x00ffff }
  },
  // Yellow Lightning
  { 
    id: 'art_mirror', name: '闪电神镜', description: '黄色闪电 (与蓝色闪电交叉引发雷暴)', 
    type: CardType.ARTIFACT, rarity: Rarity.SILVER, iconColor: '#ffff00', 
    artifactConfig: { cooldown: 45, baseDamage: 20, element: ElementType.LIGHTNING, projectileType: 'lightning', color: 0xffff00 }
  },
];

// 3. Effects (The Logic Changers)
export const EFFECT_CARDS: CardDef[] = [
  // Multi-cast
  { id: 'eff_double_g', name: '双重施法', description: '效果组重复触发 +1 (上限4次)', type: CardType.EFFECT, rarity: Rarity.GOLD, iconColor: COLORS.RARITY_GOLD, effectConfig: { logic: 'double', influenceCount: 2 } },
  
  { id: 'eff_split_s', name: '回马枪', description: '增加向后发射', type: CardType.EFFECT, rarity: Rarity.SILVER, iconColor: COLORS.RARITY_SILVER, effectConfig: { logic: 'split_back', influenceCount: 1 } },
  { id: 'eff_fan_p', name: '万箭齐发', description: '变为扇形发射 (数量+4)', type: CardType.EFFECT, rarity: Rarity.PRISMATIC, iconColor: COLORS.RARITY_PRISMATIC, effectConfig: { logic: 'fan', influenceCount: 3 } },
  { id: 'eff_track_g', name: '御物术', description: '赋予追踪能力', type: CardType.EFFECT, rarity: Rarity.GOLD, iconColor: COLORS.RARITY_GOLD, effectConfig: { logic: 'track', influenceCount: 2 } },
  
  { id: 'eff_wobble_s', name: '乱舞', description: '弹道变为波浪形', type: CardType.EFFECT, rarity: Rarity.SILVER, iconColor: COLORS.RARITY_SILVER, effectConfig: { logic: 'wobble', influenceCount: 1 } },
  { id: 'eff_giant_s', name: '巨大化', description: '体积变大，伤害提升', type: CardType.EFFECT, rarity: Rarity.SILVER, iconColor: COLORS.RARITY_SILVER, effectConfig: { logic: 'giant', influenceCount: 1 } },
];

// 4. Buffs (Stat modifiers for next artifact)
export const BUFF_CARDS: CardDef[] = [
  { id: 'buff_spd_s', name: '极速', description: '频率 +25%', type: CardType.BUFF, rarity: Rarity.SILVER, iconColor: COLORS.RARITY_SILVER, buffConfig: { frequency: 0.25 } },
  { id: 'buff_range_g', name: '广域', description: '范围 +50%', type: CardType.BUFF, rarity: Rarity.GOLD, iconColor: COLORS.RARITY_GOLD, buffConfig: { range: 0.5 } },
];


export const ALL_CARDS = [...STAT_CARDS, ...ARTIFACT_CARDS, ...EFFECT_CARDS, ...BUFF_CARDS];

export const getRandomCard = (wave: number, currentInventory: CardDef[] = [], excludeList: CardDef[] = []): CardDef => {
    // Rarity weights based on wave
    const prismChance = Math.min(0.2 + (wave / 100) * 10, 15); // 0.2% to 10%
    const goldChance = Math.min(5 + (wave / 100) * 40, 50); // 5% to 45%
    
    const roll = Math.random() * 100;
    let targetRarity = Rarity.SILVER;
    if (roll < prismChance) targetRarity = Rarity.PRISMATIC;
    else if (roll < prismChance + goldChance) targetRarity = Rarity.GOLD;

    // Filter available cards
    const pool = ALL_CARDS.filter(c => {
        // Match Rarity
        if (c.rarity !== targetRarity) return false;
        
        // Prevent Duplicate Artifacts in Inventory
        if (c.type === CardType.ARTIFACT) {
            // Check by NAME not ID
            const alreadyHas = currentInventory.some(invItem => invItem.name === c.name);
            if (alreadyHas) return false;
        }

        // Prevent Duplicates in current selection options (Exclude List)
        const isExcluded = excludeList.some(ex => ex.name === c.name);
        if (isExcluded) return false;

        return true;
    });

    // Fallback
    let finalPool = pool;
    if (finalPool.length === 0) {
        // If we ran out of cards for this rarity, fallback to ANY card of that rarity, or Stat cards
         finalPool = STAT_CARDS.filter(c => !excludeList.some(ex => ex.name === c.name)); 
        if (finalPool.length === 0) finalPool = STAT_CARDS;
    }

    const template = finalPool[Math.floor(Math.random() * finalPool.length)];
    
    // Return a copy with unique ID
    return { ...template, id: generateId() };
}
