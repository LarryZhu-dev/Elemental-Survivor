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
  RARITY_PRISMATIC: '#d946ef' // Fuchsia-500
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
    id: 'art_fire', name: '火葫芦', description: '向前方扇形喷射火焰', 
    type: CardType.ARTIFACT, rarity: Rarity.GOLD, iconColor: '#ff4500', 
    artifactConfig: { cooldown: 10, baseDamage: 2, element: ElementType.FIRE, projectileType: 'area', color: 0xff4500 }
  },
  { 
    id: 'art_wind', name: '风囊', description: '吹飞敌人，无伤害，增强火势', 
    type: CardType.ARTIFACT, rarity: Rarity.SILVER, iconColor: '#88ff88', 
    artifactConfig: { cooldown: 30, baseDamage: 0, element: ElementType.WIND, projectileType: 'area', color: 0xccffcc }
  },
  { 
    id: 'art_water', name: '白玉神盂', description: '喷射水流击退敌人，扑灭火焰', 
    type: CardType.ARTIFACT, rarity: Rarity.GOLD, iconColor: '#00bfff', 
    artifactConfig: { cooldown: 40, baseDamage: 5, element: ElementType.WATER, projectileType: 'beam', color: 0x00bfff }
  },
  { 
    id: 'art_pull', name: '碧玉瑶光如意', description: '全屏彩光，吸附经验', 
    type: CardType.ARTIFACT, rarity: Rarity.PRISMATIC, iconColor: '#ff00ff', 
    artifactConfig: { cooldown: 300, baseDamage: 0, element: ElementType.PHYSICAL, projectileType: 'area', color: 0xff00ff }
  },
  { 
    id: 'art_sword_orbit', name: '九天玄女剑', description: '环绕自身的飞剑', 
    type: CardType.ARTIFACT, rarity: Rarity.GOLD, iconColor: '#ffffff', 
    artifactConfig: { cooldown: 60, baseDamage: 10, element: ElementType.PHYSICAL, projectileType: 'orbit', color: 0xffffff }
  },
  { 
    id: 'art_track', name: '三尖两刃刀', description: '自动追踪敌人', 
    type: CardType.ARTIFACT, rarity: Rarity.GOLD, iconColor: '#dddddd', 
    artifactConfig: { cooldown: 30, baseDamage: 8, element: ElementType.PHYSICAL, projectileType: 'projectile', color: 0xcccccc }
  },
  { 
    id: 'art_nuke', name: '断魔雄剑', description: '随机位置天降巨剑', 
    type: CardType.ARTIFACT, rarity: Rarity.PRISMATIC, iconColor: '#333333', 
    artifactConfig: { cooldown: 120, baseDamage: 50, element: ElementType.PHYSICAL, projectileType: 'area', color: 0x000000 }
  },
  { 
    id: 'art_light', name: '闪电神镜', description: '连锁闪电攻击', 
    type: CardType.ARTIFACT, rarity: Rarity.GOLD, iconColor: '#ffff00', 
    artifactConfig: { cooldown: 50, baseDamage: 12, element: ElementType.LIGHTNING, projectileType: 'lightning', color: 0xffff00 }
  },
  { 
    id: 'art_light_combo', name: '雷公楔', description: '配合雷公锤造成强力闪电', 
    type: CardType.ARTIFACT, rarity: Rarity.GOLD, iconColor: '#cccc00', 
    artifactConfig: { cooldown: 45, baseDamage: 15, element: ElementType.LIGHTNING, projectileType: 'lightning', color: 0xffd700 }
  },
  { 
    id: 'art_hammer', name: '雷公锤', description: '仅用于配合雷公楔', 
    type: CardType.ARTIFACT, rarity: Rarity.SILVER, iconColor: '#a9a9a9', 
    artifactConfig: { cooldown: 9999, baseDamage: 0, element: ElementType.PHYSICAL, projectileType: 'projectile', color: 0x808080 }
  },
];

// 3. Effects (The Logic Changers)
export const EFFECT_CARDS: CardDef[] = [
  { id: 'eff_double_s', name: '双重触发', description: '下一法器释放两次', type: CardType.EFFECT, rarity: Rarity.SILVER, iconColor: COLORS.RARITY_SILVER, effectConfig: { logic: 'double', influenceCount: 1 } },
  { id: 'eff_double_g', name: '多重触发', description: '下两个法器释放两次', type: CardType.EFFECT, rarity: Rarity.GOLD, iconColor: COLORS.RARITY_GOLD, effectConfig: { logic: 'double', influenceCount: 2 } },
  { id: 'eff_split_s', name: '回马枪', description: '增加向后发射', type: CardType.EFFECT, rarity: Rarity.SILVER, iconColor: COLORS.RARITY_SILVER, effectConfig: { logic: 'split_back', influenceCount: 1 } },
  { id: 'eff_fan_p', name: '万箭齐发', description: '变为扇形发射', type: CardType.EFFECT, rarity: Rarity.PRISMATIC, iconColor: COLORS.RARITY_PRISMATIC, effectConfig: { logic: 'fan', influenceCount: 3 } },
  { id: 'eff_track_g', name: '御物术', description: '赋予追踪能力', type: CardType.EFFECT, rarity: Rarity.GOLD, iconColor: COLORS.RARITY_GOLD, effectConfig: { logic: 'track', influenceCount: 2 } },
];

// 4. Buffs (Stat modifiers for next artifact)
export const BUFF_CARDS: CardDef[] = [
  { id: 'buff_spd_s', name: '极速', description: '频率 +20%', type: CardType.BUFF, rarity: Rarity.SILVER, iconColor: COLORS.RARITY_SILVER, buffConfig: { frequency: 0.2 } },
  { id: 'buff_range_g', name: '广域', description: '范围 +40%', type: CardType.BUFF, rarity: Rarity.GOLD, iconColor: COLORS.RARITY_GOLD, buffConfig: { range: 0.4 } },
];


export const ALL_CARDS = [...STAT_CARDS, ...ARTIFACT_CARDS, ...EFFECT_CARDS, ...BUFF_CARDS];

export const getRandomCard = (wave: number, currentInventory: CardDef[] = []): CardDef => {
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
        
        // Prevent Duplicate Artifacts
        if (c.type === CardType.ARTIFACT) {
            // Check if we already have an artifact with this name/ID base
            // (Using ID base comparison in case we have logic to upgrade later, but strict check is fine for now)
            const alreadyHas = currentInventory.some(invItem => invItem.id === c.id);
            if (alreadyHas) return false;
        }
        return true;
    });

    // Fallback if pool is empty (e.g. collected all gold artifacts), downgrade rarity or pick stat
    let finalPool = pool;
    if (finalPool.length === 0) {
        finalPool = STAT_CARDS; // Fallback to stats
    }

    const template = finalPool[Math.floor(Math.random() * finalPool.length)];
    
    // Return a copy with unique ID (stats can be dupe, artifacts are filtered above)
    return { ...template, id: generateId() };
}