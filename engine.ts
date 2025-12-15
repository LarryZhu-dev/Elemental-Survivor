
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
        const sizeFactor = 1 + Math.min(this.wave * 0.05, 1);
        
        let color = 0x888888;
        let speed = 1.5;
        let hp = 10 + this.wave * 5;
        let dmg = 5 + this.wave;
        let size = 10;
        let xp = 1;

        if (type === 'slime') {
            color = 0x00ff00; size = 12; speed = 1.2;
        } else if (type === 'bat') {
            color = 0x5555ff; size = 8; speed = 2.5; hp *= 0.6;
        } else if (type === 'skull') {
            color = 0xdddddd; size = 14; speed = 1.0; hp *= 2.0; xp = 5;
        } else if (type === 'eye') {
            color = 0xff00ff; size = 12; speed = 1.8; hp *= 1.5; dmg *= 1.5; xp = 3;
        }

        // Apply size factor
        size *= sizeFactor;
        
        g.rect(-size, -size, size*2, size*2).fill(color);
        // Simple eyes
        g.rect(-size/2, -size/2, 4, 4).fill(0x000000);
        g.rect(size/4, -size/2, 4, 4).fill(0x000000);

        cont.addChild(g);
        cont.x = x;
        cont.y = y;
        cont.hp = hp;
        cont.maxHp = hp;
        cont.isDead = false;
        cont.vx = 0; cont.vy = 0;
        cont.knockbackVx = 0; cont.knockbackVy = 0;
        cont.radius = size;
        cont.enemyType = type;
        cont.animOffset = Math.random() * 100;
        cont.baseScale = 1;
        cont.hitFlashTimer = 0;

        // Status
        cont.isBurning = false; cont.burnTimer = 0;
        cont.isWet = false; cont.wetTimer = 0;
        cont.isElectrified = false;
        cont.hitByLightningYellow = 0;
        cont.hitByLightningBlue = 0;

        this.enemies.push(cont);
        this.world.addChild(cont);
    }

    handleWeapons(delta: number) {
        // Iterate over persistent bullets that are "weapons" (orbitals, minions)
        // OR trigger artifact cooldowns from stats.inventory
        
        // We need a way to map inventory items to their runtime state.
        // For this simple engine, we iterate stats.inventory and check/decrement cooldowns.
        // However, we need to store the cooldown timer SOMEWHERE. 
        // We'll attach it to the CardDef object in memory is risky if React re-creates it?
        // Actually stats.inventory is the source of truth. We can mutate it for cooldowns in this engine scope?
        // No, let's keep a parallel Map of cooldowns.
        
        // Hack: We will attach a runtime property to the card object itself in this memory space.
        // In a strict redux/react world this is bad, but for a game loop it's fine.
        
        this.stats.inventory.forEach((card: any, index) => {
            if (card.type !== CardType.ARTIFACT) return;

            // Initialize runtime props if missing
            if (typeof card._cooldownTimer === 'undefined') {
                card._cooldownTimer = 0;
                // Accumulate modifiers from Buffs/Effects in the chain BEFORE this card
                // For now, let's just trigger it.
            }

            if (card._cooldownTimer > 0) {
                card._cooldownTimer -= delta;
            } else {
                // FIRE!
                this.fireWeapon(card, index);
                
                // Reset Cooldown
                // Find buffs before this card in the specific chain logic?
                // For MVP, just use base config.
                let cd = card.artifactConfig.cooldown;
                // Apply global speed
                // ...
                card._cooldownTimer = cd;
            }
        });
    }

    // Evaluate the card chain to get modifiers
    getModifiersForCard(index: number) {
        // Look backwards from index-1 until we hit another Artifact or start of array
        // Collect buffs and effects.
        
        const mods = {
            damageMult: 1,
            speedMult: 1,
            rangeMult: 1,
            countAdd: 0,
            effects: [] as ActiveEffect[]
        };
        
        // Also apply global stats
        mods.damageMult *= this.stats.damageMultiplier;

        for (let i = index - 1; i >= 0; i--) {
            const c = this.stats.inventory[i];
            if (c.type === CardType.ARTIFACT) break; // Stop at previous weapon
            
            if (c.type === CardType.STAT) {
                // Stat cards work globally usually, but if placed in chain? 
                // Let's assume Stat cards are global and handled in base stats.
            }
            if (c.type === CardType.BUFF) {
                if (c.buffConfig?.frequency) mods.speedMult += c.buffConfig.frequency;
                if (c.buffConfig?.range) mods.rangeMult += c.buffConfig.range;
            }
            if (c.type === CardType.EFFECT) {
                mods.effects.push({ 
                    logic: c.effectConfig!.logic, 
                    count: c.effectConfig!.influenceCount 
                });
            }
        }
        return mods;
    }

    fireWeapon(card: CardDef, index: number) {
        const mods = this.getModifiersForCard(index);
        const config = card.artifactConfig!;

        // Base Target logic
        let target: Entity | null = null;
        if (this.isAutoAim && this.enemies.length > 0) {
            // Find closest
            let minDist = 99999;
            this.enemies.forEach(e => {
                const dx = e.x - this.player.x;
                const dy = e.y - this.player.y;
                const d = dx*dx + dy*dy;
                if (d < minDist) {
                    minDist = d;
                    target = e;
                }
            });
        }

        // Logic Processor
        // Determine projectile count, pattern, etc based on mods.effects
        let count = 1;
        let pattern = 'single';
        
        mods.effects.forEach(e => {
            if (e.logic === 'double') count += e.count; // "Double Cast" adds +1/+2 reps
            if (e.logic === 'fan') { count += 2 + e.count; pattern = 'fan'; }
            if (e.logic === 'split_back') { pattern = 'front_back'; }
        });

        // Fire loop
        for(let i=0; i<count; i++) {
             // Delay burst slightly for "Double Cast" feel? Or all at once?
             // Let's do a slight delay if count > 1 to prevent overlapping
             if (i > 0) {
                 this.delayedActions.push({
                     timer: i * 5,
                     action: () => this.spawnBullet(card, mods, target, pattern, i, count)
                 });
             } else {
                 this.spawnBullet(card, mods, target, pattern, i, count);
             }
        }
    }

    spawnBullet(card: CardDef, mods: any, target: Entity | null, pattern: string, index: number, total: number) {
        const config = card.artifactConfig!;
        const g = new Graphics();
        
        const cont = new Container() as Bullet;
        cont.addChild(g);
        
        cont.x = this.player.x;
        cont.y = this.player.y;
        cont.ownerId = card.id;
        cont.damage = config.baseDamage * mods.damageMult;
        cont.element = config.element;
        cont.color = config.color; // Required for visual logic
        cont.duration = 60 * (mods.rangeMult || 1); 
        cont.maxDuration = cont.duration;
        cont.isDead = false;
        cont.hitList = new Set();
        cont.pierce = 0;
        cont.radius = 5;
        cont.trailTimer = 0;
        
        // Mods
        cont.isTracking = mods.effects.some((e:any) => e.logic === 'track');
        cont.isWobble = mods.effects.some((e:any) => e.logic === 'wobble');
        cont.giantCount = 0;
        mods.effects.forEach((e:any) => { if(e.logic === 'giant') cont.giantCount += e.count; });
        
        if (cont.giantCount > 0) {
            cont.scale.set(1 + cont.giantCount * 0.5);
            cont.damage *= (1 + cont.giantCount * 0.5);
        }

        // Velocity Calc
        let speed = 6;
        let angle = 0;

        if (target) {
            angle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
        } else {
            // Default to moving direction or random
            if (this.joystickInput.x !== 0 || this.joystickInput.y !== 0) {
                 angle = Math.atan2(this.joystickInput.y, this.joystickInput.x);
            } else {
                 angle = Math.random() * Math.PI * 2;
            }
        }

        // Pattern mods
        if (pattern === 'fan') {
            const spread = Math.PI / 4;
            const step = spread / (total - 1 || 1);
            angle += -spread/2 + step * index;
        } else if (pattern === 'front_back') {
            if (index % 2 === 1) angle += Math.PI;
        }

        cont.vx = Math.cos(angle) * speed;
        cont.vy = Math.sin(angle) * speed;
        
        // Type Specific Rendering & Logic
        if (config.projectileType === 'projectile') {
            g.circle(0, 0, 5).fill(config.color);
        } 
        else if (config.projectileType === 'lightning') {
            // Instant hit usually, or a fast projectile?
            // Let's make it a fast projectile that looks jagged
            speed = 15;
            cont.vx = Math.cos(angle) * speed;
            cont.vy = Math.sin(angle) * speed;
            cont.pierce = 3;
            cont.duration = 20;
            // Graphic is drawn in update loop for jaggedness
        }
        else if (config.projectileType === 'area') {
            cont.vx = 0; cont.vy = 0;
            cont.duration = 30; // Short burst
            cont.radius = 60 * (mods.rangeMult || 1);
            cont.pierce = 999;
            
            // Fire Gourd Area
            if (config.element === ElementType.FIRE) {
                g.circle(0,0, cont.radius).fill({ color: config.color, alpha: 0.3 });
                cont.firePhase = 0;
            } else {
                g.circle(0,0, cont.radius).fill({ color: config.color, alpha: 0.2 });
            }
        }
        else if (config.projectileType === 'orbit') {
            // Implement orbit logic in update
        }
        else if (config.projectileType === 'water_snake') {
             // Complex snake
             cont.snakeTimer = 0;
             cont.pierce = 99;
             cont.duration = 120;
        }
        
        this.bullets.push(cont);
        this.world.addChild(cont);
    }

    updateBullets(delta: number) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            
            if (b.isDead) {
                b.destroy();
                this.bullets.splice(i, 1);
                continue;
            }

            b.duration -= delta;
            if (b.duration <= 0) {
                b.isDead = true;
                continue;
            }

            // Movement
            if (b.isWobble) {
                b.wobblePhase = (b.wobblePhase || 0) + 0.2;
                b.x += b.vx + Math.sin(b.wobblePhase) * 2;
                b.y += b.vy + Math.cos(b.wobblePhase) * 2;
            } else {
                b.x += b.vx * delta;
                b.y += b.vy * delta;
            }
            
            // Tracking
            if (b.isTracking && !b.target && this.enemies.length > 0) {
                 // Find new target
                 b.target = this.enemies[Math.floor(Math.random() * this.enemies.length)];
            }
            if (b.isTracking && b.target && !b.target.isDead) {
                const angle = Math.atan2(b.target.y - b.y, b.target.x - b.x);
                // Steer
                const steer = 0.1;
                const currentAngle = Math.atan2(b.vy, b.vx);
                // Simple lerp angle? A bit complex for simple atan2, just adjusting velocity
                b.vx = b.vx * 0.9 + Math.cos(angle) * 2 * 0.1;
                b.vy = b.vy * 0.9 + Math.sin(angle) * 2 * 0.1;
            }

            // Visual Updates
            const g = b.children[0] as Graphics;
            
            if (b.element === ElementType.LIGHTNING || b.element === ElementType.LIGHTNING_BLUE) {
                g.clear();
                // Draw jagged line
                g.moveTo(0,0);
                // The bolt is a projectile, so we draw a trail behind it
                g.lineTo(-b.vx*2, -b.vy*2);
                g.stroke({ width: 3, color: b.color }); // FORCE COLOR HERE
                
                // Add sparks
                if (Math.random() < 0.5) {
                    this.spawnParticle(b.x, b.y, b.color, 0.5);
                }
            }
            else if (b.element === ElementType.FIRE) {
                // Pulse size
                if (b.firePhase !== undefined) {
                    b.firePhase += 0.1;
                    const r = b.radius + Math.sin(b.firePhase) * 5;
                    g.clear();
                    g.circle(0,0, r).fill({ color: b.color, alpha: 0.4 }); // Use b.color
                }
            }
            else if (b.element === ElementType.WATER) {
                // Snake visuals
                // ...
            }
        }
    }

    updateEnemies(delta: number) {
        // Optimization: spatial hashing could go here
        
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            
            // Move towards player
            const dx = this.player.x - e.x;
            const dy = this.player.y - e.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist > 0) {
                e.vx = (dx / dist) * 1; // base speed
                e.vy = (dy / dist) * 1;
            }
            
            // Apply Knockback decay
            e.x += (e.vx + e.knockbackVx) * delta;
            e.y += (e.vy + e.knockbackVy) * delta;
            e.knockbackVx *= 0.9;
            e.knockbackVy *= 0.9;
            
            // Flip sprite
            const g = e.children[0];
            if (e.vx > 0) g.scale.x = 1; 
            else g.scale.x = -1;

            // Flash
            if (e.hitFlashTimer > 0) {
                e.hitFlashTimer -= delta;
                e.tint = 0xffffff; // White flash
            } else {
                e.tint = 0xFFFFFF; // Reset (Pixi default is white multiplier)
                // If we want original colors, we rely on Graphics fill. 
                // Setting tint to 0xFF0000 overlays red.
                // Resetting to 0xFFFFFF restores original graphics colors.
            }
            
            // Timers
            if (e.hitByLightningYellow > 0) e.hitByLightningYellow -= delta;
            if (e.hitByLightningBlue > 0) e.hitByLightningBlue -= delta;

            // Animation (Bounce)
            e.animOffset += delta * 0.2;
            g.y = Math.sin(e.animOffset) * 3;

            // Player Collision (Damage)
            if (dist < e.radius + this.player.radius) {
                if (this.player.invulnTimer <= 0) {
                    this.player.hp -= 10; // Fixed dmg for now
                    this.player.invulnTimer = 30;
                    this.spawnText("-10", this.player.x, this.player.y, 0xff0000);
                    // Shake
                    // ...
                    if (this.player.hp <= 0) {
                        this.onGameStateChange(GameState.GAME_OVER);
                    }
                }
            }
        }
    }

    handleCollisions(delta: number) {
        // Bullet vs Enemy
        for (const b of this.bullets) {
            // Optimization: check bounds first
            
            for (const e of this.enemies) {
                if (b.isDead) break;
                if (b.hitList.has(e.uid)) continue; // Already hit this frame/pierce? 
                // Actually unique ID logic needed for set. Pixi containers have unique IDs? 
                // e.uid doesn't exist on Container by default, we use object ref or add id.
                // Let's rely on simple distance for now and manage hitList by internal ID if needed.
                // For this demo, let's just use object reference in Set (JS Set supports objects)
                // But `uid` is safer if we destroy objects.
                
                const dx = b.x - e.x;
                const dy = b.y - e.y;
                const distSq = dx*dx + dy*dy;
                const r = b.radius + e.radius;
                
                if (distSq < r*r) {
                    // HIT
                    e.hp -= b.damage;
                    e.knockbackVx = (b.vx || 0) * 2;
                    e.knockbackVy = (b.vy || 0) * 2;
                    e.hitFlashTimer = 5;
                    
                    this.spawnDamageText(Math.floor(b.damage), e.x, e.y, b.element === ElementType.FIRE ? 0xff4500 : 0xffffff);

                    // --- Elemental & Synergy Logic ---
                    if (b.element === ElementType.LIGHTNING) {
                        e.hitByLightningYellow = 10; // 0.16s window
                    } else if (b.element === ElementType.LIGHTNING_BLUE) {
                        e.hitByLightningBlue = 10;
                    }

                    // CHECK SYNERGY: Thunderstorm
                    if (e.hitByLightningYellow > 0 && e.hitByLightningBlue > 0) {
                        // TRIGGER THUNDERSTORM
                        this.triggerThunderstorm(e.x, e.y);
                        e.hitByLightningYellow = 0; // Consume marks
                        e.hitByLightningBlue = 0;
                    }

                    if (e.hp <= 0 && !e.isDead) {
                        e.isDead = true;
                        this.spawnXP(e.x, e.y, 1); // Value based on type
                        e.destroy({children:true});
                        // Remove from array later
                    }

                    if (b.pierce > 0) {
                        b.pierce--;
                        // Add to ignore list for a short time? 
                        // For simplicity, piercing bullets just keep going. 
                        // We need to prevent hitting SAME enemy next frame.
                        // b.hitList.add(e.id); // If we had IDs.
                    } else {
                        b.isDead = true;
                    }
                }
            }
        }

        // Cleanup dead enemies
        this.enemies = this.enemies.filter(e => !e.isDead);
    }

    triggerThunderstorm(x: number, y: number) {
        // Visual: Massive chaos lines
        for(let i=0; i<10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const len = 50 + Math.random() * 100;
            const ex = x + Math.cos(angle) * len;
            const ey = y + Math.sin(angle) * len;
            
            const g = new Graphics();
            g.moveTo(x, y);
            // Jagged line
            const mx = (x+ex)/2 + (Math.random()-0.5)*20;
            const my = (y+ey)/2 + (Math.random()-0.5)*20;
            g.lineTo(mx, my);
            g.lineTo(ex, ey);
            g.stroke({ width: 2, color: 0xffffff }); // White core
            
            // Outer glow effect simulated by another wider line?
            // Pixi Graphics style
            
            const p = new Container() as any;
            p.addChild(g);
            p.life = 10;
            this.world.addChild(p);
            
            this.tempEffects.push({
                container: p,
                life: 15,
                onUpdate: (gr, l) => {
                    gr.alpha = l/15;
                }
            });
        }

        // Area Damage
        this.spawnText("THUNDERSTORM!", x, y - 20, 0xffff00);
        
        // AOE Logic
        this.enemies.forEach(e => {
            const dx = e.x - x;
            const dy = e.y - y;
            if (dx*dx + dy*dy < 150*150) {
                e.hp -= 50; 
                e.hitFlashTimer = 10;
                this.spawnDamageText(50, e.x, e.y, 0xffff00);
            }
        });
    }

    spawnXP(x: number, y: number, value: number) {
        const g = new Graphics() as XPOrb;
        const color = COLORS.XP_GREEN; 
        g.circle(0,0, 4).fill(color);
        g.x = x;
        g.y = y;
        g.value = value;
        g.vx = (Math.random()-0.5)*2;
        g.vy = (Math.random()-0.5)*2;
        g.isMagnetized = false;
        
        this.world.addChild(g);
        this.xpOrbs.push(g);
    }

    updateXP(delta: number) {
        for (let i = this.xpOrbs.length - 1; i >= 0; i--) {
            const orb = this.xpOrbs[i];
            
            // Magnet logic
            const dx = this.player.x - orb.x;
            const dy = this.player.y - orb.y;
            const distSq = dx*dx + dy*dy;
            
            if (distSq < this.stats.pickupRange * this.stats.pickupRange) {
                orb.isMagnetized = true;
            }
            
            if (orb.isMagnetized) {
                const dist = Math.sqrt(distSq);
                const speed = 12; // Fast suck
                orb.x += (dx / dist) * speed * delta;
                orb.y += (dy / dist) * speed * delta;
                
                if (dist < 10) {
                    // Collected
                    this.stats.xp += orb.value;
                    if (this.stats.xp >= this.stats.nextLevelXp) {
                         this.state = GameState.PRE_LEVEL_UP;
                         this.preLevelUpTimer = 60; // 1s slow mo effect?
                         // Actually just trigger level up
                         // this.triggerLevelUpUI(); 
                         // Let's do instant for now
                    }
                    orb.destroy();
                    this.xpOrbs.splice(i, 1);
                }
            } else {
                // Decel
                orb.x += orb.vx;
                orb.y += orb.vy;
                orb.vx *= 0.95;
                orb.vy *= 0.95;
            }
        }
    }

    triggerLevelUpUI() {
        this.stats.level++;
        this.stats.xp = 0;
        this.stats.nextLevelXp = Math.floor(this.stats.nextLevelXp * 1.5);
        this.state = GameState.LEVEL_UP;
        this.onGameStateChange(GameState.LEVEL_UP);
    }
    
    // --- Helper Visuals ---

    spawnText(text: string, x: number, y: number, color: number) {
        const t = new Text({
            text: text,
            style: {
                fontFamily: 'Courier New',
                fontSize: 24,
                fill: color,
                stroke: { color: 0x000000, width: 4 },
                fontWeight: 'bold'
            }
        });
        t.x = x;
        t.y = y;
        t.anchor.set(0.5);
        this.world.addChild(t);
        
        this.floatingTexts.push({
            container: t,
            x: x, y: y,
            life: 60,
            velocityY: -1
        });
    }

    spawnDamageText(dmg: number, x: number, y: number, color: number) {
        // Limit spawn rate slightly
        this.spawnText(dmg.toString(), x + (Math.random()-0.5)*10, y - 20, color);
    }

    spawnParticle(x: number, y: number, color: number, lifeScale = 1, isStatic = false) {
        const g = new Graphics() as Particle;
        g.rect(-2, -2, 4, 4).fill(color);
        g.x = x; g.y = y;
        g.vx = (Math.random()-0.5)*4;
        g.vy = (Math.random()-0.5)*4;
        g.life = 20 * lifeScale;
        g.maxLife = g.life;
        g.isStatic = isStatic;
        
        this.world.addChild(g);
        this.particles.push(g);
    }

    updateParticles(delta: number) {
        for(let i=this.particles.length-1; i>=0; i--) {
            const p = this.particles[i];
            p.life -= delta;
            if (p.life <= 0) {
                p.destroy();
                this.particles.splice(i, 1);
                continue;
            }
            if (!p.isStatic) {
                p.x += p.vx * delta;
                p.y += p.vy * delta;
            }
            p.alpha = p.life / p.maxLife;
        }
    }

    updateFloatingTexts(delta: number) {
        for(let i=this.floatingTexts.length-1; i>=0; i--) {
            const ft = this.floatingTexts[i];
            ft.life -= delta;
            if (ft.life <= 0) {
                ft.container.destroy();
                this.floatingTexts.splice(i, 1);
                continue;
            }
            ft.container.y += ft.velocityY * delta;
            ft.container.alpha = ft.life / 30; // fade out last 30 frames
        }
    }

    updateTempEffects(delta: number) {
        for(let i=this.tempEffects.length-1; i>=0; i--) {
            const eff = this.tempEffects[i];
            eff.life -= delta;
            if (eff.life <= 0) {
                eff.container.destroy();
                this.tempEffects.splice(i, 1);
                continue;
            }
            eff.onUpdate(eff.container, eff.life);
        }
    }
    
    // --- API for React/GM ---
    
    resume() {
        this.state = GameState.PLAYING;
    }
    
    addCard(card: CardDef) {
        this.stats.inventory.push(card);
    }

    reorderInventory(newInventory: CardDef[]) {
        this.stats.inventory = newInventory;
    }
    
    debugRemoveCard(index: number) {
        this.stats.inventory.splice(index, 1);
    }
    
    debugSetWave(w: number) {
        this.wave = w;
        this.waveEnemiesSpawned = 0;
    }

    destroy() {
        this.app.destroy(true, { children: true });
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mousedown', this.handleMouseDown);
    }
}
