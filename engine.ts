import { Application, Container, Graphics, Text, Ticker } from 'pixi.js';
import { CardDef, CardType, ElementType, EnemyDef, GameState, MapType, PlayerStats, Rarity } from './types';
import { SCREEN_HEIGHT, SCREEN_WIDTH, COLORS } from './constants';

// --- internal types ---
type Entity = Container & {
    vx: number;
    vy: number;
    knockbackVx: number;
    knockbackVy: number;
    hp: number;
    maxHp: number;
    isDead: boolean;
    radius: number;
    // Status
    isBurning: boolean;
    burnTimer: number;
    isWet: boolean;
    wetTimer: number;
    isElectrified: boolean;
    
    // Synergy Flags
    hitByLightningYellow: number; // Timer for Mirror
    hitByLightningBlue: number;   // Timer for Wedge

    // Visuals
    enemyType: 'slime' | 'bat' | 'skull' | 'eye' | 'boss';
    animOffset: number;
    baseScale: number;
    hitFlashTimer: number;

    // Boss Props
    isBoss?: boolean;
    bossType?: number;
    bossActionTimer?: number;

    // Player Specific
    invulnTimer: number;
    moveTarget?: {x: number, y: number};
}

type Bullet = Container & {
    vx: number;
    vy: number;
    damage: number;
    element: ElementType;
    duration: number;
    maxDuration: number;
    radius: number;
    ownerId: string;
    isDead: boolean;
    // Specific logic
    isTracking?: boolean;
    pierce: number;
    hitList: Set<number>; // Enemy IDs hit
    // Visuals
    trailTimer: number; 
    color: number; 
    
    // Persistent Weapon State
    state?: string; // 'IDLE', 'SEEK', 'RETURN', 'ATTACK'
    target?: Entity | null;
    orbitAngle?: number;
    attackTimer?: number; 
    
    // Logic modifiers
    isWobble?: boolean;
    wobblePhase?: number;
    giantCount: number; // Stacking giant effect

    // Water Snake Specific
    snakeTimer?: number;
    
    // Fire Gourd Specific (Plasma visual)
    firePhase?: number;

    // Lightning Specific
    lightningTarget?: {x: number, y: number};
}

type Particle = Graphics & {
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    isStatic: boolean; 
}

type XPOrb = Graphics & {
    value: number;
    vx: number;
    vy: number;
    isMagnetized?: boolean;
    tier: number; // 0-5
}

// Managed Text system to avoid Ticker overload
interface FloatingText {
    container: Text;
    x: number;
    y: number;
    life: number;
    velocityY: number;
}

interface TemporaryEffect {
    container: Graphics;
    life: number;
    onUpdate: (g: Graphics, life: number) => void;
}

interface DelayedAction {
    timer: number;
    action: () => void;
}

interface ActiveEffect {
    logic: string;
    count: number; 
}

// Map Chunking
const CHUNK_SIZE = 1000;

export class GameEngine {
    app: Application;
    canvas: HTMLCanvasElement;
    state: GameState = GameState.MENU;
    
    // Containers
    world: Container;
    
    // Entities
    player: Entity;
    enemies: Entity[] = [];
    bullets: Bullet[] = [];
    particles: Particle[] = [];
    xpOrbs: XPOrb[] = [];
    obstacles: Graphics[] = []; 
    generatedChunks: Set<string> = new Set();
    
    // Managed Visuals
    floatingTexts: FloatingText[] = [];
    tempEffects: TemporaryEffect[] = [];

    // Game Logic
    stats: PlayerStats;
    wave: number = 1;
    waveTimer: number = 0; 
    gameTime: number = 0;
    
    // Wave Logic
    waveTotalEnemies: number = 0;
    waveEnemiesSpawned: number = 0;
    waveDelayTimer: number = 0;

    // Cutscene Logic
    preLevelUpTimer: number = 0;

    // Input
    mouse: { x: number, y: number } = { x: 0, y: 0 };
    isAutoAim: boolean = true;
    joystickInput: { x: number, y: number } = { x: 0, y: 0 };
    
    // Performance
    damageTextCooldown: number = 0;

    // Action Queue
    delayedActions: DelayedAction[] = [];

    // Callbacks to React
    onUpdateStats: (stats: PlayerStats) => void;
    onGameStateChange: (state: GameState) => void;
    onBossWarning: (name: string) => void;
    onUpdateAimStatus: (isAuto: boolean) => void;

    // Config
    mapType: MapType = MapType.FIXED;
    
    constructor(
        canvas: HTMLCanvasElement, 
        onUpdateStats: (s: PlayerStats) => void,
        onGameStateChange: (s: GameState) => void,
        onBossWarning: (n: string) => void,
        onUpdateAimStatus: (isAuto: boolean) => void
    ) {
        this.canvas = canvas;
        this.app = new Application();

        this.onUpdateStats = onUpdateStats;
        this.onGameStateChange = onGameStateChange;
        this.onBossWarning = onBossWarning;
        this.onUpdateAimStatus = onUpdateAimStatus;

        // Init Stats
        this.stats = {
            hp: 100,
            maxHp: 100,
            level: 1,
            xp: 0,
            nextLevelXp: 10,
            speed: 5,
            damageMultiplier: 1,
            pickupRange: 120,
            inventory: []
        };

        this.addInitialWeapon();
        
        // Placeholders to satisfy TS, real init in init()
        this.world = new Container(); 
        this.player = new Container() as Entity; 
    }

    async init() {
        await this.app.init({
            canvas: this.canvas,
            width: SCREEN_WIDTH,
            height: SCREEN_HEIGHT,
            backgroundColor: 0x1a1a2e,
            antialias: false,
            resolution: Math.min(window.devicePixelRatio, 2), 
        });

        // Init Containers
        this.world = new Container();
        this.app.stage.addChild(this.world);
        
        this.world.sortableChildren = true;

        // Init Player
        this.player = this.createPlayer();
        this.world.addChild(this.player);

        // Bind Inputs
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mousedown', this.handleMouseDown);

        // Start Loop
        this.app.ticker.add(this.update.bind(this));
        
        this.onUpdateAimStatus(this.isAutoAim);
    }

    addInitialWeapon() {
        const starter: CardDef = {
            id: 'starter',
            name: '初始法球',
            description: '基础攻击',
            type: CardType.ARTIFACT,
            rarity: Rarity.SILVER,
            iconColor: '#00ffff',
            artifactConfig: {
                cooldown: 50,
                baseDamage: 5, 
                element: ElementType.PHYSICAL,
                projectileType: 'projectile',
                color: 0x00ffff
            }
        };
        this.stats.inventory.push(starter);
    }

    createPlayer(): Entity {
        const cont = new Container() as Entity;
        
        const g = new Graphics();
        // --- Pixel Art: Wizard ---
        g.rect(-6, -8, 12, 16).fill(0x3b82f6); 
        g.rect(-6, -12, 12, 4).fill(0x1d4ed8);
        g.rect(-4, -10, 8, 4).fill(0xffccaa);
        g.rect(-6, 0, 12, 2).fill(0xfca5a5);
        g.rect(6, -10, 2, 20).fill(0x78350f);
        g.rect(5, -12, 4, 4).fill(0xef4444);

        cont.addChild(g);
        cont.x = SCREEN_WIDTH / 2;
        cont.y = SCREEN_HEIGHT / 2;
        cont.vx = 0;
        cont.vy = 0;
        cont.knockbackVx = 0;
        cont.knockbackVy = 0;
        cont.hp = 100;
        cont.maxHp = 100;
        cont.radius = 12; // Hitbox radius
        cont.isDead = false;
        cont.zIndex = 100;
        cont.invulnTimer = 0;
        cont.hitFlashTimer = 0;

        return cont;
    }

    start(mapType: MapType) {
        this.mapType = mapType;
        this.state = GameState.PLAYING;
        
        // Init Wave Data
        this.wave = 1;
        this.waveEnemiesSpawned = 0;
        this.waveTotalEnemies = 20; // Increased base count
        this.waveDelayTimer = 0;

        // Cleanup any existing entities from previous session
        this.enemies.forEach(e => { if(!e.destroyed) e.destroy({children:true}); });
        this.enemies = [];
        this.bullets.forEach(b => { if(!b.destroyed) b.destroy({children:true}); });
        this.bullets = [];
        this.xpOrbs.forEach(x => { if(!x.destroyed) x.destroy(); });
        this.xpOrbs = [];
        this.obstacles.forEach(o => { if(!o.destroyed) o.destroy(); });
        this.obstacles = [];
        this.generatedChunks.clear();

        this.updateMapChunks();
        this.onGameStateChange(GameState.PLAYING);
    }

    // Deterministic Map Generation
    updateMapChunks() {
        const cx = Math.floor(this.player.x / CHUNK_SIZE);
        const cy = Math.floor(this.player.y / CHUNK_SIZE);

        for (let x = cx - 1; x <= cx + 1; x++) {
            for (let y = cy - 1; y <= cy + 1; y++) {
                const key = `${x},${y}`;
                if (!this.generatedChunks.has(key)) {
                    this.generateChunk(x, y);
                    this.generatedChunks.add(key);
                }
            }
        }
    }

    generateChunk(cx: number, cy: number) {
        let seed = (cx * 374761393) ^ (cy * 668265263);
        const seededRandom = () => {
            seed = (seed ^ 61) ^ (seed >> 16);
            seed += (seed << 3);
            seed = seed ^ (seed >> 4);
            seed *= 668265263;
            seed = seed ^ (seed >> 15);
            return (seed >>> 0) / 4294967296;
        };

        const count = 10; 
        for(let i=0; i<count; i++) {
             const obs = new Graphics();
             const type = seededRandom();
             const ox = (cx * CHUNK_SIZE) + seededRandom() * CHUNK_SIZE;
             const oy = (cy * CHUNK_SIZE) + seededRandom() * CHUNK_SIZE;

             if (type < 0.3) {
                 obs.rect(-4, 0, 8, 12).fill(0x5c4033); 
                 obs.rect(-12, -24, 24, 24).fill(0x228b22); 
             } else if (type < 0.6) {
                 obs.rect(-10, -5, 20, 10).fill(0x555555);
                 obs.rect(-5, -10, 10, 5).fill(0x777777);
             } else {
                 obs.rect(-10, -30, 20, 60).fill(0x8b4513);
             }
             
             obs.x = ox;
             obs.y = oy;
             
             this.obstacles.push(obs);
             this.world.addChild(obs);
             obs.zIndex = 5;
        }
    }

    setJoystick(x: number, y: number) {
        this.joystickInput = { x, y };
    }

    handleKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Escape') {
            if (this.state === GameState.PLAYING) {
                this.state = GameState.PAUSED;
                this.onGameStateChange(GameState.PAUSED);
            } else if (this.state === GameState.PAUSED) {
                this.state = GameState.PLAYING;
                this.onGameStateChange(GameState.PLAYING);
            }
        }
        if (e.code === 'KeyA') {
            this.isAutoAim = !this.isAutoAim;
            this.onUpdateAimStatus(this.isAutoAim);
        }
    }

    handleMouseMove = (e: MouseEvent) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
    }

    handleMouseDown = (e: MouseEvent) => {
        if (this.state !== GameState.PLAYING) return;
        
        // Don't process tap-to-move if joystick is active
        if (this.joystickInput.x !== 0 || this.joystickInput.y !== 0) return;

        const worldX = (e.clientX - SCREEN_WIDTH/2) + this.player.x;
        const worldY = (e.clientY - SCREEN_HEIGHT/2) + this.player.y;
        
        this.player.moveTarget = { x: worldX, y: worldY };
        
        const marker = new Graphics();
        marker.rect(-2, -2, 4, 4).fill(0xffffff);
        marker.x = worldX;
        marker.y = worldY;
        this.world.addChild(marker);
        
        this.tempEffects.push({
            container: marker,
            life: 15,
            onUpdate: (g, l) => { g.alpha = l / 15; }
        });
    }

    update(ticker: Ticker) {
        const delta = ticker.deltaTime;
        
        this.updateParticles(delta);
        this.updateFloatingTexts(delta);
        this.updateTempEffects(delta);

        if (this.state === GameState.PRE_LEVEL_UP) {
            this.preLevelUpTimer -= delta;
            
            if (Math.random() < 0.3) {
                 this.spawnParticle(
                     this.player.x + (Math.random()-0.5)*30, 
                     this.player.y + 10, 
                     0xffd700, 
                     1, 
                     true 
                 );
            }

            this.world.pivot.x = this.player.x;
            this.world.pivot.y = this.player.y;
            this.world.position.x = SCREEN_WIDTH / 2;
            this.world.position.y = SCREEN_HEIGHT / 2;

            if (this.preLevelUpTimer <= 0) {
                this.triggerLevelUpUI();
            }
            return;
        }

        if (this.state !== GameState.PLAYING) return;
        
        this.gameTime += delta;

        if (Math.floor(this.gameTime) % 60 === 0) {
            this.updateMapChunks();
        }

        // Process delayed actions
        for (let i = this.delayedActions.length - 1; i >= 0; i--) {
            this.delayedActions[i].timer -= delta;
            if (this.delayedActions[i].timer <= 0) {
                this.delayedActions[i].action();
                this.delayedActions.splice(i, 1);
            }
        }
        
        this.updatePlayerMovement(delta);

        this.world.pivot.x = this.player.x;
        this.world.pivot.y = this.player.y;
        this.world.position.x = SCREEN_WIDTH / 2;
        this.world.position.y = SCREEN_HEIGHT / 2;

        this.handleSpawning(delta);
        this.handleWeapons(delta);

        this.updateEnemies(delta);
        this.updateBullets(delta);
        this.updateXP(delta);

        this.handleCollisions(delta);

        if (Math.floor(this.gameTime) % 15 === 0) {
            this.onUpdateStats({ ...this.stats, hp: this.player.hp, maxHp: this.player.maxHp });
        }
    }

    updatePlayerMovement(delta: number) {
        if (this.player.invulnTimer > 0) {
            this.player.invulnTimer -= delta;
            this.player.alpha = 0.5;
        } else {
            this.player.alpha = 1;
        }

        // Joystick Logic (Prioritized)
        if (this.joystickInput.x !== 0 || this.joystickInput.y !== 0) {
            const speed = 4 * delta * (this.stats.speed / 5); 
            this.player.x += this.joystickInput.x * speed;
            this.player.y += this.joystickInput.y * speed;
            this.player.moveTarget = undefined; // Cancel tap-to-move if using joystick
        } 
        // Tap to Move Logic
        else if (this.player.moveTarget) {
            const dx = this.player.moveTarget.x - this.player.x;
            const dy = this.player.moveTarget.y - this.player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 5) {
                const speed = 4 * delta * (this.stats.speed / 5); 
                this.player.x += (dx / dist) * speed;
                this.player.y += (dy / dist) * speed;
            } else {
                this.player.moveTarget = undefined;
            }
        }
    }

    handleSpawning(delta: number) {
        if (this.waveDelayTimer > 0) {
            this.waveDelayTimer -= delta;
            if (this.waveDelayTimer <= 0) {
                this.wave++;
                this.waveEnemiesSpawned = 0;
                // Scale Enemy Count aggressively
                this.waveTotalEnemies = Math.floor(20 + Math.pow(this.wave, 1.2) * 5);
                
                if (this.wave % 10 === 0) {
                    this.onBossWarning(`WAVE ${this.wave} BOSS`);
                    this.spawnBoss(this.wave);
                    this.waveEnemiesSpawned++;
                } else {
                    this.spawnText(`WAVE ${this.wave}`, this.player.x, this.player.y - 100, 0xffffff);
                }
            }
            return;
        }

        if (this.waveEnemiesSpawned >= this.waveTotalEnemies && this.enemies.length === 0) {
            this.waveDelayTimer = 120;
            return;
        }

        if (this.waveEnemiesSpawned < this.waveTotalEnemies) {
             // Cap active enemies for performance
             if (this.enemies.length < 80 + this.wave) {
                 const chance = 0.05 + (this.wave * 0.005);
                 if (Math.random() < chance) {
                     this.spawnEnemy(false);
                     this.waveEnemiesSpawned++;
                 }
             }
        }
    }

    // New Boss Spawning Logic
    spawnBoss(wave: number) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 600; 
        const x = this.player.x + Math.cos(angle) * dist;
        const y = this.player.y + Math.sin(angle) * dist;

        const cont = new Container() as Entity;
        const g = new Graphics();
        
        const bossIndex = Math.floor(wave / 10) % 10; // 0-9 variants
        const hpMultiplier = wave * 250;
        
        let color = 0xff0000;
        let size = 50;
        // Boss visual slightly improved
        g.rect(-size/2, -size/2, size, size).fill(color);
        // Boss Eye
        g.rect(-10, -10, 20, 20).fill(0xffff00);
        g.rect(-40, -5, 80, 10).fill(0x330000); // Arms

        cont.addChild(g);
        cont.x = x;
        cont.y = y;
        cont.maxHp = 2000 + hpMultiplier;
        cont.hp = cont.maxHp;
        cont.radius = size/2;
        cont.isDead = false;
        cont.vx = 0; cont.vy = 0;
        cont.knockbackVx = 0; cont.knockbackVy = 0;
        cont.isBoss = true;
        cont.enemyType = 'boss';
        cont.bossType = bossIndex;
        cont.bossActionTimer = 120; // 2 sec cooldown
        cont.animOffset = Math.random() * 100;
        cont.baseScale = 1;

        // Init status
        cont.isBurning = false; cont.burnTimer = 0;
        cont.isWet = false; cont.wetTimer = 0;
        cont.isElectrified = false;
        cont.hitByLightningYellow = 0;
        cont.hitByLightningBlue = 0;
        cont.hitFlashTimer = 0;

        this.enemies.push(cont);
        this.world.addChild(cont);
    }

    spawnEnemy(isBoss: boolean) {
        if (isBoss) return; // Handled by spawnBoss

        const angle = Math.random() * Math.PI * 2;
        const dist = 600 + Math.random() * 200; 
        const x = this.player.x + Math.cos(angle) * dist;
        const y = this.player.y + Math.sin(angle) * dist;

        const cont = new Container() as Entity;
        const g = new Graphics();
        
        // 1. Difficulty & Type Scaling
        let type: 'slime' | 'bat' | 'skull' | 'eye' = 'slime';
        if (this.wave > 3 && Math.random() > 0.6) type = 'bat';
        if (this.wave > 10 && Math.random() > 0.7) type = 'skull';
        if (this.wave > 20 && Math.random() > 0.8) type = 'eye';

        // 2. Size Scaling: Exponential growth with wave
        // Base size + (wave * factor)
        const sizeFactor = 1 + Math.min(2, this.wave * 0.02);

        let size = 16;
        let hp = 20 + this.wave * 10;
        let speed = 2 + Math.min(3, this.wave * 0.05);
        let color = 0x888888;
        let xp = 1;

        if (type === 'slime') {
            size = 16;
            color = 0x4ade80;
            speed *= 0.8;
            g.rect(-size/2, -size/2, size, size).fill(color);
        } else if (type === 'bat') {
            size = 12;
            hp *= 0.6;
            speed *= 1.3;
            color = 0xa78bfa;
            xp = 2;
            g.moveTo(0, -size/2).lineTo(size/2, size/2).lineTo(-size/2, size/2).fill(color);
        } else if (type === 'skull') {
            size = 18;
            hp *= 1.5;
            speed *= 0.9;
            color = 0xe5e7eb;
            xp = 3;
            g.circle(0, 0, size/2).fill(color);
            g.rect(-4, 0, 8, 8).fill(color);
        } else if (type === 'eye') {
            size = 20;
            hp *= 2;
            speed *= 1.1;
            color = 0xf87171;
            xp = 5;
            g.circle(0, 0, size/2).fill(color);
            g.circle(0, 0, 4).fill(0x000000); // pupil
        }

        cont.addChild(g);
        cont.x = x;
        cont.y = y;
        cont.maxHp = hp;
        cont.hp = hp;
        cont.radius = size/2;
        cont.isDead = false;
        cont.vx = 0; cont.vy = 0;
        cont.knockbackVx = 0; cont.knockbackVy = 0;
        cont.enemyType = type;
        cont.animOffset = Math.random() * 100;
        cont.baseScale = sizeFactor;

        // Init status
        cont.isBurning = false; cont.burnTimer = 0;
        cont.isWet = false; cont.wetTimer = 0;
        cont.isElectrified = false;
        cont.hitByLightningYellow = 0;
        cont.hitByLightningBlue = 0;
        cont.hitFlashTimer = 0;
        
        // Adjust for scale
        cont.scale.set(sizeFactor);
        cont.radius *= sizeFactor;
        
        // XP Value stored in container for drop
        (cont as any).xpValue = xp;

        this.enemies.push(cont);
        this.world.addChild(cont);
    }

    handleWeapons(delta: number) {
        // Collect active effects/buffs first for this frame
        let currentBuffs: CardDef[] = [];
        let currentEffects: CardDef[] = [];

        // Iterate through inventory linearly
        // This allows effects to apply to the NEXT artifact
        for (const card of this.stats.inventory) {
            if (card.type === CardType.STAT) continue;

            if (card.type === CardType.BUFF) {
                currentBuffs.push(card);
            } else if (card.type === CardType.EFFECT) {
                currentEffects.push(card);
            } else if (card.type === CardType.ARTIFACT && card.artifactConfig) {
                // It's a weapon, time to fire?
                // We need to track cooldown per unique card instance ID
                let weaponState = (card as any)._weaponState;
                if (!weaponState) {
                    weaponState = { cooldown: 0 };
                    (card as any)._weaponState = weaponState;
                }

                weaponState.cooldown -= delta;
                if (weaponState.cooldown <= 0) {
                    // Calculate modified stats
                    let damage = card.artifactConfig.baseDamage * this.stats.damageMultiplier;
                    let freqMod = 1;
                    let rangeMod = 1;

                    // Apply Buffs
                    for (const b of currentBuffs) {
                        if (b.buffConfig?.frequency) freqMod += b.buffConfig.frequency;
                        if (b.buffConfig?.range) rangeMod += b.buffConfig.range;
                    }

                    // FIRE
                    this.fireBullet(card, currentEffects, damage, rangeMod);

                    // Reset Cooldown
                    const baseCd = card.artifactConfig.cooldown;
                    weaponState.cooldown = Math.max(5, baseCd / (1 + (freqMod - 1))); // Speed = 1/CD

                    // Consume one-time buffs if we designed them that way? 
                    // No, "Chain" logic implies buffs apply to next artifact. 
                    // Usually in these games, buffs persist for the chain block or reset.
                    // For this simple engine, let's say they reset after use.
                    currentBuffs = [];
                    currentEffects = [];
                }
            }
        }
    }

    fireBullet(card: CardDef, effects: CardDef[], damage: number, rangeMod: number) {
        // Find Target
        let target: Entity | null = null;
        let minDist = 9999;
        
        // Auto Aim
        if (this.isAutoAim && this.enemies.length > 0) {
            for (const e of this.enemies) {
                const dx = e.x - this.player.x;
                const dy = e.y - this.player.y;
                const d = dx*dx + dy*dy;
                if (d < minDist) {
                    minDist = d;
                    target = e;
                }
            }
        } 
        
        let tx = 0, ty = -1;
        if (target) {
            const dx = target.x - this.player.x;
            const dy = target.y - this.player.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            tx = dx/dist; ty = dy/dist;
        } else if (!this.isAutoAim) {
             // Manual Aim towards mouse or last movement?
             // Simple: Mouse
             const dx = this.mouse.x - SCREEN_WIDTH/2;
             const dy = this.mouse.y - SCREEN_HEIGHT/2;
             const dist = Math.sqrt(dx*dx + dy*dy);
             if (dist > 0) { tx = dx/dist; ty = dy/dist; }
        }

        const createSingleBullet = (angleOffset: number, speedMod: number, isBackward: boolean) => {
             const angle = Math.atan2(ty, tx) + angleOffset + (isBackward ? Math.PI : 0);
             const vx = Math.cos(angle);
             const vy = Math.sin(angle);
             
             this.createBullet(
                 this.player.x, 
                 this.player.y, 
                 vx, vy, 
                 card, 
                 damage, 
                 rangeMod,
                 target
             );
        };

        // Apply Effects Logic (Multicast, Split, etc)
        let count = 1;
        let spread = 0;
        let backward = false;

        effects.forEach(e => {
            if (e.effectConfig?.logic === 'fan') {
                count += 4;
                spread = Math.PI / 4;
            } else if (e.effectConfig?.logic === 'double') {
                count *= 2; // Simple double count
            } else if (e.effectConfig?.logic === 'split_back') {
                backward = true;
            }
        });

        // Loop spawn
        for(let i=0; i<count; i++) {
            // Fan spread calculation
            const offset = count > 1 ? -spread/2 + (spread/(count-1)) * i : 0;
            createSingleBullet(offset, 1, false);
            if (backward) createSingleBullet(offset, 1, true);
        }
    }

    createBullet(x: number, y: number, vx: number, vy: number, card: CardDef, damage: number, rangeMod: number, target: Entity | null) {
        if (!card.artifactConfig) return;
        
        const b = new Container() as Bullet;
        b.x = x;
        b.y = y;
        b.vx = vx * 6; // Base speed
        b.vy = vy * 6;
        b.damage = damage;
        b.element = card.artifactConfig.element;
        b.duration = 60 * rangeMod;
        b.maxDuration = b.duration;
        b.ownerId = card.id;
        b.isDead = false;
        b.hitList = new Set();
        b.radius = 8;
        b.color = card.artifactConfig.color; // Pass color explicitly
        
        // Custom props based on type
        const type = card.artifactConfig.projectileType;
        
        // Draw visual
        const g = new Graphics();
        b.addChild(g);
        
        if (type === 'projectile') {
            g.circle(0, 0, 6).fill(b.color);
            b.pierce = 1;
        } else if (type === 'beam') {
            b.vx = 0; b.vy = 0; // Stick to player?
            // Beam logic handled in update
        } else if (type === 'lightning') {
            b.vx = 0; b.vy = 0;
            b.duration = 10; // Instant flash
            b.pierce = 999;
            // Target specific
            if (target) {
                b.lightningTarget = { x: target.x, y: target.y };
            } else {
                 b.lightningTarget = { x: x + vx*300, y: y + vy*300 };
            }
        } else if (type === 'area') {
             b.vx *= 0.2; b.vy *= 0.2; // Slow moving cloud
             b.radius = 40 * rangeMod;
             b.duration = 120;
             b.pierce = 999;
             // Draw handled in update for animation
        } else if (type === 'water_snake') {
            // Logic handled in update
            b.snakeTimer = 0;
            b.pierce = 999;
            b.duration = 180;
        } else if (type === 'pull_screen') {
            // Special instant effect
            this.triggerScreenPull();
            b.isDead = true; 
            return; 
        }

        this.bullets.push(b);
        this.world.addChild(b);
    }

    triggerScreenPull() {
        this.xpOrbs.forEach(orb => {
            orb.isMagnetized = true;
        });
        // Flash Effect
        const flash = new Graphics();
        flash.rect(0,0,SCREEN_WIDTH, SCREEN_HEIGHT).fill({ color: 0xffffff, alpha: 0.5 });
        this.app.stage.addChild(flash);
        this.tempEffects.push({
            container: flash,
            life: 10,
            onUpdate: (g, l) => g.alpha = l/20
        });
    }

    updateBullets(delta: number) {
        for (const b of this.bullets) {
            b.x += b.vx * delta;
            b.y += b.vy * delta;
            b.duration -= delta;
            
            if (b.duration <= 0) b.isDead = true;

            const g = b.children[0] as Graphics;
            g.clear();

            // Dynamic Drawing based on color
            if (b.element === ElementType.FIRE) {
                // Pulse effect
                const size = b.radius * (0.8 + Math.sin(this.gameTime * 0.2)*0.2);
                g.circle(0, 0, size).fill({ color: b.color, alpha: 0.6 });
            } 
            else if (b.element === ElementType.WATER) {
                 // Snake trail logic could go here, simplified as stream
                 g.circle(0,0, b.radius).fill({ color: b.color, alpha: 0.7 });
            }
            else if (b.element === ElementType.LIGHTNING || b.element === ElementType.LIGHTNING_BLUE) {
                // Draw jagged line to target
                if (b.lightningTarget) {
                    const lx = b.lightningTarget.x - b.x;
                    const ly = b.lightningTarget.y - b.y;
                    const dist = Math.sqrt(lx*lx + ly*ly);
                    const segments = 5;
                    
                    g.moveTo(0,0);
                    let currX = 0; let currY = 0;
                    for(let i=1; i<segments; i++) {
                         const t = i/segments;
                         const jitter = (Math.random()-0.5) * 40;
                         const nextX = lx*t + jitter;
                         const nextY = ly*t + jitter;
                         g.lineTo(nextX, nextY);
                         currX = nextX; currY = nextY;
                    }
                    g.lineTo(lx, ly);
                    g.stroke({ width: 3, color: b.color }); // Explicit color usage
                }
            }
            else {
                // Standard projectile
                g.circle(0, 0, 6).fill(b.color);
            }
        }
        
        // Remove dead
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            if (this.bullets[i].isDead) {
                this.world.removeChild(this.bullets[i]);
                this.bullets.splice(i, 1);
            }
        }
    }

    updateEnemies(delta: number) {
        for (const e of this.enemies) {
            // Apply Status
            if (e.isBurning) {
                e.burnTimer -= delta;
                if (Math.floor(e.burnTimer) % 30 === 0) {
                     this.damageEnemy(e, 1, false);
                }
                if (e.burnTimer <= 0) e.isBurning = false;
            }

            // Synergy Timers decay
            if (e.hitByLightningYellow > 0) e.hitByLightningYellow -= delta;
            if (e.hitByLightningBlue > 0) e.hitByLightningBlue -= delta;

            // Flash
            if (e.hitFlashTimer > 0) {
                 e.hitFlashTimer -= delta;
                 e.tint = 0xffffff; // Flash white (Pixi 8 uses tint differently, simplistic here)
                 e.alpha = 0.5;
            } else {
                 e.tint = 0xFFFFFF;
                 e.alpha = 1;
            }

            // Movement - Seek Player
            if (!e.isDead) {
                const dx = this.player.x - e.x;
                const dy = this.player.y - e.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                // Knockback decay
                e.knockbackVx *= 0.9;
                e.knockbackVy *= 0.9;

                if (dist > 0) {
                    // Base movement
                    e.vx = (dx / dist) * e.baseScale * (this.wave > 5 ? 1.5 : 1);
                    e.vy = (dy / dist) * e.baseScale;
                }
                
                e.x += (e.vx + e.knockbackVx) * delta;
                e.y += (e.vy + e.knockbackVy) * delta;
            }
        }

        // Clean dead
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            if (this.enemies[i].isDead) {
                // Drop XP
                this.spawnXP(this.enemies[i].x, this.enemies[i].y, (this.enemies[i] as any).xpValue);
                this.world.removeChild(this.enemies[i]);
                this.enemies.splice(i, 1);
            }
        }
    }

    handleCollisions(delta: number) {
        // Bullet vs Enemy
        for (const b of this.bullets) {
            for (const e of this.enemies) {
                if (e.isDead) continue;
                if (b.hitList.has(e.uid)) continue; // Check unique ID properly if strictly needed, using index for now implies danger. 
                // We don't have UIDs on entities in this snippet, let's just check distance collision + hit delay for piercing
                // For piercing to work properly with "hitList", we need IDs. 
                // Let's assume `e` object ref is key for Set.
                const mapKey = (e as any)._pixiId || Math.random(); 

                const dx = b.x - e.x;
                const dy = b.y - e.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                // Lightning is special, check logic
                let isHit = false;
                if (b.element === ElementType.LIGHTNING || b.element === ElementType.LIGHTNING_BLUE) {
                    // Lightning hit check (Area or Line) - Simplification: Circular radius around target
                    if (b.lightningTarget) {
                        const ldx = b.lightningTarget.x - e.x;
                        const ldy = b.lightningTarget.y - e.y;
                        if (ldx*ldx + ldy*ldy < 2000) isHit = true; // Hit things near target
                    }
                } else {
                    if (dist < e.radius + b.radius) isHit = true;
                }

                if (isHit && !b.hitList.has(mapKey)) {
                    // Synergy Check: Lightning Storm
                    if (b.element === ElementType.LIGHTNING) {
                         // Yellow Hit
                         if (e.hitByLightningBlue > 0) {
                             this.triggerLightningStorm(e.x, e.y);
                         }
                         e.hitByLightningYellow = 120; // Mark for 2 seconds
                    } else if (b.element === ElementType.LIGHTNING_BLUE) {
                         // Blue Hit
                         if (e.hitByLightningYellow > 0) {
                             this.triggerLightningStorm(e.x, e.y);
                         }
                         e.hitByLightningBlue = 120; // Mark for 2 seconds
                    }

                    // Damage
                    this.damageEnemy(e, b.damage, b.damage > 50);
                    
                    // Add to hit list
                    b.hitList.add(mapKey);
                    
                    // Knockback
                    const k = 5;
                    e.knockbackVx = (b.vx || 0) * k;
                    e.knockbackVy = (b.vy || 0) * k;

                    // Pierce logic
                    b.pierce--;
                    if (b.pierce <= 0) {
                        b.isDead = true;
                        break; // Stop checking other enemies for this bullet
                    }
                }
            }
        }

        // Player vs Enemy
        if (this.player.invulnTimer <= 0) {
            for (const e of this.enemies) {
                const dx = this.player.x - e.x;
                const dy = this.player.y - e.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist < this.player.radius + e.radius) {
                    this.player.hp -= 10; // Base enemy damage
                    this.player.invulnTimer = 30; // 0.5s invuln
                    this.spawnText("-10", this.player.x, this.player.y, 0xff0000);
                    
                    if (this.player.hp <= 0) {
                        this.state = GameState.GAME_OVER;
                        this.onGameStateChange(GameState.GAME_OVER);
                    }
                    break;
                }
            }
        }
    }

    triggerLightningStorm(x: number, y: number) {
        // Visuals: Lots of small chaotic bolts
        for(let i=0; i<8; i++) {
             const ox = (Math.random()-0.5) * 100;
             const oy = (Math.random()-0.5) * 100;
             // Use creating bullet for visual, but 0 damage so we control damage centrally
             // Or better, just a pure visual bullet
             const b = new Container() as Bullet;
             b.x = x + ox;
             b.y = y + oy;
             b.vx = 0; b.vy = 0;
             b.damage = 0; // We deal AOE damage separately
             b.element = ElementType.LIGHTNING; // Use yellow for storm
             b.duration = 10;
             b.isDead = false;
             b.radius = 0;
             b.color = 0xffffff; // White core storm
             b.hitList = new Set();
             b.lightningTarget = { x: x + (Math.random()-0.5)*50, y: y + (Math.random()-0.5)*50 };
             
             const g = new Graphics();
             b.addChild(g);
             this.bullets.push(b);
             this.world.addChild(b);
        }

        // Flash Area
        const flash = new Graphics();
        flash.circle(0,0, 100).fill({ color: 0xffffaa, alpha: 0.5 });
        flash.x = x; flash.y = y;
        this.world.addChild(flash);
        this.tempEffects.push({
             container: flash,
             life: 10,
             onUpdate: (g, l) => g.alpha = l/10
        });

        // AOE Damage
        for(const e of this.enemies) {
             const dx = e.x - x;
             const dy = e.y - y;
             if (dx*dx + dy*dy < 10000) { // 100 radius
                 this.damageEnemy(e, 50, true); // Massive damage
             }
        }
        
        this.spawnText("THUNDER STORM!", x, y - 50, 0xffff00);
    }

    damageEnemy(e: Entity, dmg: number, isCrit: boolean) {
        e.hp -= dmg;
        e.hitFlashTimer = 5;
        this.spawnText(Math.floor(dmg).toString(), e.x, e.y - 20, isCrit ? 0xffff00 : 0xffffff);
        if (e.hp <= 0) e.isDead = true;
    }

    spawnText(text: string, x: number, y: number, color: number) {
        const t = new Text({
            text: text,
            style: {
                fontFamily: 'Courier New',
                fontSize: 16,
                fill: color,
                stroke: { color: 0x000000, width: 2 }
            }
        });
        t.x = x;
        t.y = y;
        this.world.addChild(t);
        this.floatingTexts.push({
            container: t,
            x: x,
            y: y,
            life: 60,
            velocityY: -1
        });
    }

    updateFloatingTexts(delta: number) {
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.life -= delta;
            ft.y += ft.velocityY * delta;
            ft.container.y = ft.y;
            ft.container.alpha = ft.life / 30; // Fade out last 0.5s

            if (ft.life <= 0) {
                this.world.removeChild(ft.container);
                this.floatingTexts.splice(i, 1);
            }
        }
    }
    
    updateTempEffects(delta: number) {
        for (let i = this.tempEffects.length - 1; i >= 0; i--) {
             const eff = this.tempEffects[i];
             eff.life -= delta;
             eff.onUpdate(eff.container, eff.life);
             if (eff.life <= 0) {
                 if (eff.container.parent) eff.container.parent.removeChild(eff.container);
                 this.tempEffects.splice(i, 1);
             }
        }
    }

    spawnXP(x: number, y: number, value: number) {
        const xp = new Graphics() as XPOrb;
        let color = COLORS.XP_GREEN;
        if (value > 5) color = COLORS.XP_BLUE;
        if (value > 20) color = COLORS.XP_ORANGE;
        
        xp.circle(0,0, 4).fill(color);
        xp.x = x;
        xp.y = y;
        xp.value = value;
        xp.vx = (Math.random()-0.5)*2;
        xp.vy = (Math.random()-0.5)*2;
        
        this.xpOrbs.push(xp);
        this.world.addChild(xp);
    }

    updateXP(delta: number) {
        for (let i = this.xpOrbs.length - 1; i >= 0; i--) {
            const orb = this.xpOrbs[i];
            
            // Magnet logic
            const dx = this.player.x - orb.x;
            const dy = this.player.y - orb.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (orb.isMagnetized || dist < this.stats.pickupRange) {
                const speed = 10;
                orb.x += (dx/dist) * speed * delta;
                orb.y += (dy/dist) * speed * delta;
                
                if (dist < 10) {
                    // Collect
                    this.gainXP(orb.value);
                    this.world.removeChild(orb);
                    this.xpOrbs.splice(i, 1);
                    continue;
                }
            } else {
                // Drift friction
                orb.x += orb.vx;
                orb.y += orb.vy;
                orb.vx *= 0.95;
                orb.vy *= 0.95;
            }
        }
    }

    gainXP(amount: number) {
        this.stats.xp += amount;
        if (this.stats.xp >= this.stats.nextLevelXp) {
             this.stats.xp -= this.stats.nextLevelXp;
             this.stats.level++;
             this.stats.nextLevelXp = Math.floor(this.stats.nextLevelXp * 1.5);
             this.triggerPreLevelUp();
        }
    }

    triggerPreLevelUp() {
        this.state = GameState.PRE_LEVEL_UP;
        this.preLevelUpTimer = 60; // 1 second animation
        this.onGameStateChange(GameState.PRE_LEVEL_UP);
    }

    triggerLevelUpUI() {
        this.state = GameState.LEVEL_UP;
        this.onGameStateChange(GameState.LEVEL_UP);
    }

    updateParticles(delta: number) {
        for(let i=this.particles.length-1; i>=0; i--) {
            const p = this.particles[i];
            p.life -= delta;
            if(!p.isStatic) {
                p.x += p.vx * delta;
                p.y += p.vy * delta;
            }
            p.alpha = p.life / p.maxLife;
            if (p.life <= 0) {
                this.world.removeChild(p);
                this.particles.splice(i, 1);
            }
        }
    }

    spawnParticle(x: number, y: number, color: number, count: number = 1, isStatic: boolean = false) {
        for(let i=0; i<count; i++) {
            const p = new Graphics() as Particle;
            p.rect(-2,-2,4,4).fill(color);
            p.x = x; p.y = y;
            p.vx = (Math.random()-0.5) * 4;
            p.vy = (Math.random()-0.5) * 4;
            p.life = 30 + Math.random() * 20;
            p.maxLife = p.life;
            p.isStatic = isStatic;
            this.particles.push(p);
            this.world.addChild(p);
        }
    }

    // --- GM Tools API ---
    addCard(card: CardDef) {
        this.stats.inventory.push(card);
        this.onUpdateStats({ ...this.stats, hp: this.player.hp, maxHp: this.player.maxHp });
    }
    
    reorderInventory(newInventory: CardDef[]) {
        this.stats.inventory = newInventory;
    }
    
    resume() {
        this.state = GameState.PLAYING;
    }

    destroy() {
        this.app.destroy({ removeView: true }, { children: true, texture: true });
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mousedown', this.handleMouseDown);
    }

    // GM Debug methods
    debugRemoveCard(index: number) {
        if (index >= 0 && index < this.stats.inventory.length) {
            this.stats.inventory.splice(index, 1);
            this.onUpdateStats({ ...this.stats });
        }
    }

    debugSetWave(wave: number) {
        this.wave = wave;
        this.waveEnemiesSpawned = 0;
        this.waveTotalEnemies = Math.floor(20 + Math.pow(this.wave, 1.2) * 5);
        this.enemies.forEach(e => { if(!e.destroyed) e.destroy({children:true}); });
        this.enemies = [];
        this.bullets = [];
    }
}