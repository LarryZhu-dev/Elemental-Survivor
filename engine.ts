
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
        const sizeFactor = 1 + Math.pow(this.wave, 1.1) * 0.05;
        
        // Draw based on type
        switch(type) {
            case 'slime':
                // Green, blobby
                g.roundRect(-8, -8, 16, 16, 5).fill(0x10b981);
                g.circle(-3, -3, 2).fill(0x000000); // Eye
                g.circle(3, -3, 2).fill(0x000000); // Eye
                cont.radius = 8 * sizeFactor;
                break;
            case 'bat':
                // Purple, fast, flying V shape
                g.poly([-10, -5, 0, 5, 10, -5, 0, 2]).fill(0x8b5cf6);
                cont.radius = 6 * sizeFactor;
                break;
            case 'skull':
                // Grey, slow, tough
                g.rect(-10, -12, 20, 20).fill(0x9ca3af);
                g.rect(-4, 8, 8, 4).fill(0x9ca3af); // Jaw
                g.rect(-6, -4, 4, 4).fill(0x000000); // Eye
                g.rect(2, -4, 4, 4).fill(0x000000); // Eye
                cont.radius = 12 * sizeFactor;
                break;
            case 'eye':
                // Red, floating, watching
                g.circle(0, 0, 10).fill(0xffffff);
                g.circle(0, 0, 4).fill(0xff0000); // Iris
                g.circle(0, 0, 14).stroke({ width: 2, color: 0xef4444 });
                cont.radius = 10 * sizeFactor;
                break;
        }

        cont.scale.set(sizeFactor);
        cont.baseScale = sizeFactor;
        
        cont.addChild(g);
        cont.x = x;
        cont.y = y;
        
        const waveHP = (10 + Math.pow(this.wave, 1.6) * 3) * sizeFactor;
        cont.maxHp = waveHP;
        cont.hp = cont.maxHp;
        
        cont.isDead = false;
        cont.vx = 0; cont.vy = 0;
        cont.knockbackVx = 0; cont.knockbackVy = 0;
        
        cont.isBurning = false; cont.burnTimer = 0;
        cont.isWet = false; cont.wetTimer = 0;
        cont.isElectrified = false;
        cont.hitByLightningYellow = 0;
        cont.hitByLightningBlue = 0;
        cont.hitFlashTimer = 0;
        cont.enemyType = type;
        cont.animOffset = Math.random() * 100;

        this.enemies.push(cont);
        this.world.addChild(cont);
    }

    // --- WEAPON SYSTEM ---
    weaponCooldowns: { [key: string]: number } = {};

    handleWeapons(delta: number) {
        let activeEffects: ActiveEffect[] = [];
        let buffStats = { rangeMult: 1, speedMult: 1, freqMult: 1 };
        
        for (const card of this.stats.inventory) {
            // Cooldown Reduction Buffs
            if (card.type === CardType.BUFF && card.buffConfig) {
                 if (card.buffConfig.range) buffStats.rangeMult += card.buffConfig.range;
                 if (card.buffConfig.speed) buffStats.speedMult += card.buffConfig.speed;
                 if (card.buffConfig.frequency) buffStats.freqMult += card.buffConfig.frequency;
                 continue;
            }

            // Determine Repetition Count based on active 'double' effects
            let executionCount = 1;
            activeEffects.forEach(eff => {
                if (eff.logic === 'double') executionCount *= 2;
            });
            
            // STRICT LIMIT: Max 4x Cast per group
            executionCount = Math.min(executionCount, 4);

            const newEffects: ActiveEffect[] = [];

            if (card.type === CardType.EFFECT && card.effectConfig) {
                for(let i=0; i<executionCount; i++) {
                     newEffects.push({
                         logic: card.effectConfig.logic,
                         count: card.effectConfig.influenceCount
                     });
                }
            } 
            else if (card.type === CardType.ARTIFACT && card.artifactConfig) {
                if (!this.weaponCooldowns[card.id]) this.weaponCooldowns[card.id] = 0;
                this.weaponCooldowns[card.id] -= delta * buffStats.freqMult;

                const isPersistent = card.artifactConfig.projectileType === 'orbit' || card.artifactConfig.projectileType === 'minion';
                
                if (isPersistent) {
                    this.fireArtifact(card, activeEffects, buffStats, 0);
                } 
                else if (this.weaponCooldowns[card.id] <= 0) {
                    for(let i=0; i<executionCount; i++) {
                         if (i === 0) {
                             this.fireArtifact(card, activeEffects, buffStats, i);
                         } else {
                             const capturedEffects = [...activeEffects.map(e => ({...e}))]; 
                             this.delayedActions.push({
                                 timer: i * 8, 
                                 action: () => this.fireArtifact(card, capturedEffects, buffStats, i)
                             });
                         }
                    }
                    this.weaponCooldowns[card.id] = card.artifactConfig.cooldown;
                }
            }

            const isArtifact = card.type === CardType.ARTIFACT;
            activeEffects.forEach(eff => {
                if (eff.logic === 'double') {
                    eff.count--;
                } else if (isArtifact) {
                    eff.count--;
                }
            });
            activeEffects = activeEffects.filter(eff => eff.count > 0);
            activeEffects.push(...newEffects);
        }
    }

    fireArtifact(card: CardDef, activeEffects: ActiveEffect[], buffs: any, dupeIndex: number = 0) {
        if (!card.artifactConfig) return;
        const conf = card.artifactConfig;

        // --- Jade Ruyi (Pull) Special Logic ---
        if (conf.projectileType === 'pull_screen') {
             const flash = new Graphics();
             flash.rect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT).fill({color: 0xff00ff, alpha: 0.2});
             flash.blendMode = 'add';
             this.world.addChild(flash);
             
             this.tempEffects.push({
                 container: flash,
                 life: 30,
                 onUpdate: (g, life) => { g.alpha = (life/30) * 0.4; }
             });

             let count = 0;
             this.xpOrbs.forEach(orb => {
                 orb.isMagnetized = true;
                 count++;
             });

             if (count > 0 && dupeIndex === 0) this.spawnText("GATHER!", this.player.x, this.player.y - 60, 0xff00ff);
             return; 
        }

        // Persistent Weapon Checks
        if (conf.projectileType === 'orbit' || conf.projectileType === 'minion') {
            const activeInstances = this.bullets.filter(b => b.ownerId === card.id && !b.isDead).length;
            if (activeInstances > dupeIndex) return;
        }

        let isFan = false;
        let isRing = false;
        let isBack = false;
        let track = false;
        let wobble = false;
        let giantCount = 0; // Changed from boolean to number
        
        activeEffects.forEach(m => {
            if (m.logic === 'split_back') isBack = true;
            if (m.logic === 'fan') isFan = true;
            if (m.logic === 'ring') isRing = true;
            if (m.logic === 'track') track = true;
            if (m.logic === 'wobble') wobble = true;
            if (m.logic === 'giant') giantCount += 1; // Accumulate Giant
        });
        
        const flags = { track, wobble, giantCount };

        // --- Lightning Logic ---
        if (conf.element === ElementType.LIGHTNING || conf.element === ElementType.LIGHTNING_BLUE) {
            const range = 400 * buffs.rangeMult;
            let currentSource = { x: this.player.x, y: this.player.y };
            let potentialTargets = this.enemies.filter(e => {
                const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
                return d < range && !e.isDead && !e.destroyed;
            });
            // Sort by distance
            potentialTargets.sort((a,b) => Math.hypot(a.x-this.player.x, a.y-this.player.y) - Math.hypot(b.x-this.player.x, b.y-this.player.y));

            let chains = 3 + (isFan ? 4 : 0) + (isRing ? 6 : 0); 
            if (isBack) chains += 2;
            
            const lightningColor = conf.element;
            const visualColor = conf.color;

            for(let i=0; i<chains; i++) {
                if (potentialTargets.length === 0) break;
                
                let closestIdx = -1;
                let minD = 9999;
                for(let j=0; j<potentialTargets.length; j++) {
                     const t = potentialTargets[j];
                     const d = Math.hypot(t.x - currentSource.x, t.y - currentSource.y);
                     if (d < minD) { minD = d; closestIdx = j; }
                }

                if (closestIdx !== -1) {
                    const target = potentialTargets[closestIdx];
                    this.drawLightning(currentSource.x, currentSource.y, target.x, target.y, visualColor, giantCount, wobble);
                    
                    // Giant scales damage for lightning too
                    const dmg = conf.baseDamage * this.stats.damageMultiplier * (1 + giantCount * 0.5);
                    this.applyLightningDamage(target, dmg, lightningColor);
                    
                    currentSource = { x: target.x, y: target.y };
                    potentialTargets.splice(closestIdx, 1);
                }
            }
            return; 
        }

        // Projectile Angles
        let baseAngle = 0;
        let targetEnemy = null;
        
        if (this.isAutoAim) {
            let minD = 99999;
            this.enemies.forEach(e => {
                if (e.isDead || e.destroyed) return;
                const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
                if (d < minD) { minD = d; targetEnemy = e; }
            });
            if (targetEnemy && !targetEnemy.destroyed) {
                baseAngle = Math.atan2(targetEnemy.y - this.player.y, targetEnemy.x - this.player.x);
            } else {
                const dx = this.mouse.x - (SCREEN_WIDTH / 2);
                const dy = this.mouse.y - (SCREEN_HEIGHT / 2);
                baseAngle = Math.atan2(dy, dx);
            }
        } else {
            const dx = this.mouse.x - (SCREEN_WIDTH / 2);
            const dy = this.mouse.y - (SCREEN_HEIGHT / 2);
            baseAngle = Math.atan2(dy, dx);
        }

        if (conf.element === ElementType.FIRE) {
             isFan = true;
        }

        let projectileCount = 1;
        if (isFan) projectileCount += 4;
        if (isRing) projectileCount = 12;

        const angles: number[] = [];
        
        if (isRing) {
            for(let i=0; i<projectileCount; i++) angles.push(baseAngle + (Math.PI * 2 * i / projectileCount));
        } else if (isFan) {
            const spread = 0.8; // Radians
            const start = baseAngle - spread/2;
            const step = spread / (projectileCount - 1);
            for(let i=0; i<projectileCount; i++) angles.push(start + step * i);
        } else {
            angles.push(baseAngle);
        }

        if (isBack) {
            const currentAngles = [...angles];
            currentAngles.forEach(a => angles.push(a + Math.PI)); 
        }
        
        angles.forEach(angle => {
            this.createBullet(conf, angle, buffs, flags, card.id, dupeIndex);
        });
    }

    drawLightning(x1: number, y1: number, x2: number, y2: number, color: number, giantCount: number, isWobble: boolean) {
        const g = new Graphics();
        const dist = Math.hypot(x2-x1, y2-y1);
        const steps = Math.max(3, Math.floor(dist / 15));
        
        g.moveTo(x1, y1);
        
        // Jagged line
        for(let i=1; i<steps; i++) {
            const t = i / steps;
            const targetX = x1 + (x2-x1)*t;
            const targetY = y1 + (y2-y1)*t;
            // Wobble increases jitter for lightning
            const jitter = isWobble ? 40 : 20;
            const px = targetX + (Math.random()-0.5)*jitter;
            const py = targetY + (Math.random()-0.5)*jitter;
            g.lineTo(px, py);
        }
        g.lineTo(x2, y2);
        
        // Giant increases thickness
        const thickness = 3 + giantCount * 2;
        g.stroke({ width: thickness, color: 0xffffff, alpha: 1 });
        g.stroke({ width: thickness * 2, color: color, alpha: 0.4 }); // Glow

        this.world.addChild(g);
        
        this.tempEffects.push({
            container: g,
            life: 6,
            onUpdate: (gfx, life) => { gfx.alpha = life/6; }
        });
    }

    applyLightningDamage(e: Entity, dmg: number, type: ElementType) {
        if (e.isDead || e.destroyed) return;
        
        // Check for Lightning + Fire interaction
        if (e.isBurning) {
            this.spawnLightningStorm(e.x, e.y, 0.6); // Mini storm
            e.isBurning = false; // Overload consumes burn
            this.spawnText("OVERLOAD", e.x, e.y - 40, 0xffaa00);
        }

        e.hp -= dmg;
        e.isElectrified = true;
        
        if (type === ElementType.LIGHTNING) e.hitByLightningYellow = 20; 
        if (type === ElementType.LIGHTNING_BLUE) e.hitByLightningBlue = 20; 

        if (e.hitByLightningYellow > 0 && e.hitByLightningBlue > 0) {
            this.spawnLightningStorm(e.x, e.y, 1.0);
            e.hitByLightningYellow = 0;
            e.hitByLightningBlue = 0;
        } else {
            this.spawnText(Math.round(dmg).toString(), e.x, e.y - 20, type === ElementType.LIGHTNING_BLUE ? 0x00ffff : 0xffff00);
        }

        if (e.hp <= 0) this.killEnemy(e);
    }

    spawnLightningStorm(x: number, y: number, scale = 1.0) {
        const g = new Graphics();
        g.circle(0,0, 120 * scale).fill({color: 0xffffff, alpha: 0.9});
        g.circle(0,0, 100 * scale).fill({color: 0x8800ff, alpha: 0.5});
        g.x = x; g.y = y;
        g.blendMode = 'add';
        this.world.addChild(g);
        
        this.tempEffects.push({
            container: g,
            life: 25,
            onUpdate: (gfx, l) => { 
                gfx.scale.set(1 + (25-l)*0.1); 
                gfx.alpha = l/25; 
            }
        });

        const radius = 150 * scale;
        this.enemies.forEach(e => {
            if (e.isDead || e.destroyed) return;
            const d = Math.hypot(e.x - x, e.y - y);
            if (d < radius) {
                e.hp -= 200 * this.stats.damageMultiplier * scale; 
                if (e.hp <= 0) this.killEnemy(e);
            }
        });
    }

    createBullet(conf: any, angle: number, buffs: any, flags: {track: boolean, wobble: boolean, giantCount: number}, ownerId: string, dupeIndex: number) {
        const b = new Container() as Bullet;
        const g = new Graphics();
        
        let speed = 5 * buffs.speedMult;
        let life = 180 * buffs.rangeMult; 
        let radius = 12;
        
        // Stacking Giant Logic
        const scaleMod = 1 + (flags.giantCount * 0.5); 
        b.scale.set(scaleMod);

        // --- Wind Bag (Universal Direction Support) ---
        if (conf.element === ElementType.WIND) {
             const r = 80 * buffs.rangeMult;
             radius = r;
             // Visible Shockwave
             g.arc(0, 0, r, -0.5, 0.5).stroke({ width: 4, color: 0xffffff, alpha: 0.8 });
             g.arc(0, 0, r*0.8, -0.4, 0.4).stroke({ width: 2, color: 0xa5f3fc, alpha: 0.5 });
             life = 40; 
             speed = 4; // Moves forward
             b.scale.set(0.1 * scaleMod); // Apply Giant
             b.rotation = angle;
        } 
        else if (conf.element === ElementType.FIRE) {
             radius = 60 * buffs.rangeMult;
             speed = 3 * buffs.speedMult;
             life = 45 * buffs.rangeMult;
             b.rotation = angle; // Direction
             b.firePhase = Math.random() * 10;
        }
        else if (conf.projectileType === 'water_snake') {
             radius = 15;
             g.circle(0,0, 8).fill(0xa5f3fc); // Head
             g.circle(0,0, 12).stroke({width: 2, color: 0xffffff, alpha: 0.5});
             speed = 6 * buffs.speedMult;
             life = 60 * buffs.rangeMult;
             b.snakeTimer = 0;
             b.pierce = 999; 
             b.rotation = angle;
        }
        else if (conf.projectileType === 'minion') {
            g.rect(-2, -20, 4, 60).fill(0x52525b); 
            g.rect(-3, 30, 6, 5).fill(0xd4d4d8); 
            g.moveTo(0, -20); g.lineTo(-10, -30); g.lineTo(10, -30); g.fill(0xffd700); 
            g.beginPath();
            g.moveTo(0, -30); g.lineTo(-4, -80); g.lineTo(4, -80); g.fill(0xe2e8f0); 
            g.moveTo(-8, -30); g.quadraticCurveTo(-20, -40, -12, -60); g.lineTo(-8, -30); g.fill(0xe2e8f0);
            g.moveTo(8, -30); g.quadraticCurveTo(20, -40, 12, -60); g.lineTo(8, -30); g.fill(0xe2e8f0);

            speed = 0;
            life = 999999;
            b.state = 'IDLE';
            b.orbitAngle = dupeIndex * (Math.PI); 
            b.attackTimer = 0;
            b.scale.set(1.2 * scaleMod);
        }
        else if (conf.projectileType === 'projectile') {
            g.circle(0,0, 5).fill(0xffffff); 
            g.circle(0,0, 8).fill({ color: conf.color, alpha: 0.6 }); 
            g.blendMode = 'add';
            b.rotation = angle + Math.PI/2;
        } 
        
        b.addChild(g);
        b.x = this.player.x;
        b.y = this.player.y;
        b.vx = Math.cos(angle) * speed;
        b.vy = Math.sin(angle) * speed;
        
        b.damage = conf.baseDamage * this.stats.damageMultiplier * scaleMod;
        b.element = conf.element;
        b.duration = life;
        b.maxDuration = life;
        b.radius = radius;
        b.ownerId = ownerId;
        b.isDead = false;
        b.isTracking = flags.track;
        b.isWobble = flags.wobble;
        b.wobblePhase = Math.random() * 10;
        b.hitList = new Set();
        b.pierce = (conf.projectileType === 'area' || conf.element === ElementType.FIRE || conf.element === ElementType.WIND || conf.projectileType === 'water_snake') ? 999 : 1;
        b.color = conf.color;
        b.trailTimer = 0;
        b.giantCount = flags.giantCount;

        this.bullets.push(b);
        this.world.addChild(b);
    }

    updateEnemies(delta: number) {
        const playerPos = { x: this.player.x, y: this.player.y };
        
        this.enemies.forEach(e => {
            if (e.isDead || e.destroyed) return;

            // Update synergy timers
            if (e.hitByLightningYellow > 0) e.hitByLightningYellow -= delta;
            if (e.hitByLightningBlue > 0) e.hitByLightningBlue -= delta;

            if (e.hitFlashTimer > 0) {
                e.hitFlashTimer -= delta;
                e.tint = 0xff0000;
            } else {
                e.tint = 0xffffff;
            }

            // Animation Squeeze
            e.animOffset += delta * 0.2;
            const squeeze = Math.sin(e.animOffset) * 0.1;
            e.scale.x = e.baseScale * (1 + squeeze);
            e.scale.y = e.baseScale * (1 - squeeze);

            // Boss AI
            if (e.isBoss && e.bossActionTimer !== undefined) {
                e.bossActionTimer -= delta;
                if (e.bossActionTimer <= 0) {
                    this.bossAttack(e);
                    e.bossActionTimer = Math.max(30, 120 - this.wave); 
                }
            }

            const dx = playerPos.x - e.x;
            const dy = playerPos.y - e.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            let moveSpeed = (1 + (this.wave * 0.005)) * delta;
            
            // Adjust speed by type
            if (e.enemyType === 'bat') moveSpeed *= 1.5;
            if (e.enemyType === 'skull') moveSpeed *= 0.7;
            if (e.isBoss) moveSpeed *= 0.5;

            e.knockbackVx *= 0.85; 
            e.knockbackVy *= 0.85;

            if (dist > 10) {
                // Collision with other enemies
                if (this.enemies.length < 100) {
                    let pushX = 0, pushY = 0;
                    this.enemies.forEach(other => {
                        if (e === other || other.isDead || other.destroyed) return;
                        const idx = e.x - other.x;
                        const idy = e.y - other.y;
                        const idist = Math.sqrt(idx*idx + idy*idy);
                        if (idist < (e.radius + other.radius)) {
                            const force = 1 - (idist / (e.radius + other.radius));
                            pushX += (idx / idist) * force;
                            pushY += (idy / idist) * force;
                        }
                    });
                    e.x += pushX * 1; 
                    e.y += pushY * 1;
                }
                
                e.x += (dx / dist) * moveSpeed;
                e.y += (dy / dist) * moveSpeed;
            }
            
            e.x += e.knockbackVx * delta;
            e.y += e.knockbackVy * delta;

            if (e.isBurning) {
                e.hp -= 0.1 * delta * (1 + this.wave*0.1);
                if (Math.random() < 0.1) this.spawnParticle(e.x, e.y, 0xff4500);
            }

            if (e.hp <= 0) this.killEnemy(e);
        });

        // Safe Cleanup
        const keep: Entity[] = [];
        this.enemies.forEach(e => {
            if (e.isDead) {
                if(!e.destroyed) e.destroy({ children: true });
            } else {
                keep.push(e);
            }
        });
        this.enemies = keep;
    }

    bossAttack(boss: Entity) {
        const angle = Math.atan2(this.player.y - boss.y, this.player.x - boss.x);
        if (boss.bossType === 5) { // Dasher
             boss.knockbackVx = Math.cos(angle) * 15;
             boss.knockbackVy = Math.sin(angle) * 15;
        } else {
             boss.knockbackVx = Math.cos(angle) * 5;
             boss.knockbackVy = Math.sin(angle) * 5;
        }
    }

    updateBullets(delta: number) {
        this.bullets.forEach(b => {
            if (b.isDead || b.destroyed) return;
            
            // --- Universal Wobble Logic ---
            if (b.isWobble) {
                if (b.wobblePhase === undefined) b.wobblePhase = 0;
                b.wobblePhase += 0.2 * delta;
                
                // For directional things (projectiles, snakes)
                if (b.vx !== 0 || b.vy !== 0) {
                    const len = Math.hypot(b.vx, b.vy);
                    if (len > 0) {
                        const px = -b.vy / len;
                        const py = b.vx / len;
                        const offset = Math.sin(b.wobblePhase) * 2 * delta;
                        b.x += b.vx * delta + px * offset;
                        b.y += b.vy * delta + py * offset;
                        // Don't return, allow other updates
                    }
                } 
                // For static things (Wind/Fire/Area), we might want to jiggle position
                else if (b.element === ElementType.FIRE || b.element === ElementType.WIND) {
                     b.x = this.player.x + Math.sin(b.wobblePhase) * 5;
                     b.y = this.player.y + Math.cos(b.wobblePhase) * 5;
                }
            } else {
                // Normal movement if not wobbling directional
                 if (b.vx !== 0 || b.vy !== 0 && !b.isWobble) {
                    b.x += b.vx * delta;
                    b.y += b.vy * delta;
                 }
            }

            // --- Visual Expansions ---
            if (b.element === ElementType.WIND) {
                // Ensure giant scale is respected in growth
                const growth = 0.08 * delta;
                b.scale.x += growth; 
                b.scale.y += growth;
                b.alpha -= 0.02 * delta;
                if (b.alpha <= 0) this.killBullet(b);
                b.duration -= delta;
                return; 
            }
            if (b.element === ElementType.FIRE) {
                 const g = b.children[0] as Graphics;
                 g.clear();
                 const t = 1 - (b.duration / b.maxDuration); 
                 const currentRadius = b.radius * (0.5 + t * 0.5);
                 
                 for(let i=0; i<5; i++) {
                     const offset = Math.random() * 10;
                     const a = Math.random() * Math.PI * 2;
                     const ox = Math.cos(a) * offset;
                     const oy = Math.sin(a) * offset;
                     const col = Math.random() > 0.5 ? 0xff4500 : 0xffaa00;
                     g.circle(ox, oy, currentRadius * (0.5 + Math.random()*0.5)).fill({color: col, alpha: 0.3});
                 }
                 
                 // Apply giant to the time-based expansion
                 const baseScale = 1 + (b.giantCount || 0) * 0.5;
                 b.scale.set(baseScale * (1 + t * 1)); 
                 
                 b.alpha = 1 - t;
                 b.duration -= delta;
                 if (b.duration <= 0) this.killBullet(b);
                 return;
            }
            
            if (b.snakeTimer !== undefined) {
                // Scale based on giant count too
                const baseScale = 1 + (b.giantCount || 0) * 0.5;
                b.scale.set(Math.max(0.1, b.duration / 60) * baseScale);
                
                b.snakeTimer += delta;
                if (b.snakeTimer > 2) { 
                    const body = new Graphics();
                    const r = 12 * b.scale.x;
                    body.circle(0,0, r).fill({color: 0x00bfff, alpha: 0.6});
                    body.x = b.x + (Math.random()-0.5)*5;
                    body.y = b.y + (Math.random()-0.5)*5;
                    this.world.addChild(body);
                    
                    this.tempEffects.push({
                        container: body,
                        life: 40,
                        onUpdate: (g, l) => {
                             g.alpha = l/40;
                             g.scale.set(1 + (40-l)*0.05); 
                        }
                    });
                    b.snakeTimer = 0;
                }
                
                b.rotation += Math.sin(b.duration * 0.2) * 0.05;
                // Wobble handled above generic check, but snake needs direction update
                if (!b.isWobble) {
                    b.vx = Math.cos(b.rotation) * 6; 
                    b.vy = Math.sin(b.rotation) * 6;
                }
            }
            
            b.duration -= delta;
            if (b.duration <= 0 || b.alpha <= 0) {
                this.killBullet(b);
                return;
            }

            if (b.vx !== 0 || b.vy !== 0) {
                b.trailTimer -= delta;
                if (b.trailTimer <= 0) {
                    if (!b.ownerId.startsWith('art_track') && !b.snakeTimer) {
                       if (Math.random() > 0.7) {
                          const p = new Graphics();
                          p.rect(0,0, 4, 4).fill(b.color);
                          p.x = b.x; p.y = b.y;
                          this.world.addChild(p);
                          this.tempEffects.push({
                              container: p, life: 15, onUpdate: (g,l) => { g.alpha = l/15; g.rotation += 0.1; }
                          });
                       }
                    }
                    b.trailTimer = 3; 
                }
            }

            // --- Minion Logic ---
            if (b.ownerId.startsWith('art_track')) {
                if (!b.state) b.state = 'IDLE';
                if (!b.attackTimer) b.attackTimer = 0;

                if (b.state === 'IDLE') {
                    if (b.orbitAngle === undefined) b.orbitAngle = 0;
                    b.orbitAngle += 0.02 * delta; 
                    const targetX = this.player.x + Math.cos(b.orbitAngle) * 50;
                    const targetY = this.player.y + Math.sin(b.orbitAngle) * 50 - 30;
                    
                    b.x += (targetX - b.x) * 0.1 * delta;
                    b.y += (targetY - b.y) * 0.1 * delta;
                    b.rotation = 0; 

                    if (b.attackTimer > 0) b.attackTimer -= delta;
                    else {
                        let closest = null;
                        let minD = 500; 
                        for(const e of this.enemies) {
                            if (e.isDead || e.destroyed) continue;
                            const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
                            if(d < minD) { minD = d; closest = e; }
                        }
                        if (closest) {
                            b.state = 'ATTACK';
                            b.target = closest;
                        }
                    }
                }
                else if (b.state === 'ATTACK') {
                     if (!b.target || b.target.isDead || b.target.destroyed) {
                         b.state = 'IDLE';
                         b.target = null;
                         return;
                     }
                     const dx = b.target.x - b.x;
                     const dy = b.target.y - b.y;
                     const dist = Math.hypot(dx, dy);
                     
                     if (dist > 20) {
                         b.x += (dx/dist) * 15 * delta; 
                         b.y += (dy/dist) * 15 * delta;
                         b.rotation = Math.atan2(dy, dx) + Math.PI/2;
                     } else {
                         b.state = 'SLASH';
                         b.attackTimer = 15; 
                     }
                }
                else if (b.state === 'SLASH') {
                    b.rotation += 0.5 * delta; 
                    b.attackTimer! -= delta;
                    this.enemies.forEach(e => {
                        if (e.isDead || e.destroyed) return;
                        const d = Math.hypot(e.x - b.x, e.y - b.y);
                        if (d < 50) {
                            this.applyDamage(e, b); 
                        }
                    });

                    if (b.attackTimer! <= 0) {
                        b.state = 'IDLE';
                        b.attackTimer = 20; 
                    }
                }
                if (Math.floor(this.gameTime) % 10 === 0) b.hitList.clear();
            }
            // --- Standard Projectiles Tracking ---
            else if (b.isTracking && !b.isWobble) {
                let nearest = null;
                let minDst = 1000;
                for (const e of this.enemies) {
                    if (e.isDead || e.destroyed) continue;
                    const d = Math.hypot(e.x - b.x, e.y - b.y);
                    if (d < minDst) { minDst = d; nearest = e; }
                }
                if (nearest) {
                    const angle = Math.atan2(nearest.y - b.y, nearest.x - b.x);
                    b.vx = b.vx * 0.9 + Math.cos(angle) * 2;
                    b.vy = b.vy * 0.9 + Math.sin(angle) * 2;
                }
                b.x += b.vx * delta;
                b.y += b.vy * delta;
            }
        });
        
        const keep: Bullet[] = [];
        this.bullets.forEach(b => {
             if (b.isDead) {
                 if (!b.destroyed) b.destroy({children: true});
             } else {
                 keep.push(b);
             }
        });
        this.bullets = keep;
    }

    killBullet(b: Bullet) {
        if (b.isDead || b.destroyed) return;
        b.isDead = true;
        b.parent?.removeChild(b);
    }

    updateParticles(delta: number) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            if (!p.isStatic) {
                p.x += p.vx * delta;
                p.y += p.vy * delta;
            }
            p.alpha -= 0.03 * delta;
            p.scale.x *= 0.95; 
            p.scale.y *= 0.95;
            p.life -= delta;
            
            if (p.life <= 0 || p.alpha <= 0) {
                p.parent?.removeChild(p);
                p.destroy();
                this.particles.splice(i, 1);
            }
        }
    }

    updateFloatingTexts(delta: number) {
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.life -= delta;
            ft.y += ft.velocityY * delta;
            ft.container.y = ft.y;
            ft.container.alpha = ft.life / 30; // Fade out
            
            if (ft.life <= 0) {
                ft.container.parent?.removeChild(ft.container);
                ft.container.destroy();
                this.floatingTexts.splice(i, 1);
            }
        }
    }

    updateTempEffects(delta: number) {
        for (let i = this.tempEffects.length - 1; i >= 0; i--) {
            const ef = this.tempEffects[i];
            ef.life -= delta;
            ef.onUpdate(ef.container, ef.life);
            
            if (ef.life <= 0) {
                ef.container.parent?.removeChild(ef.container);
                ef.container.destroy();
                this.tempEffects.splice(i, 1);
            }
        }
    }

    updateXP(delta: number) {
        this.xpOrbs.forEach(orb => {
            const dx = this.player.x - orb.x;
            const dy = this.player.y - orb.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (orb.isMagnetized || dist < this.stats.pickupRange) {
                const speed = orb.isMagnetized ? 25 : 8;
                orb.x += (dx/dist) * speed * delta;
                orb.y += (dy/dist) * speed * delta;
                
                if (dist < 10) {
                    this.stats.xp += orb.value;
                    orb.parent?.removeChild(orb);
                    orb.destroy(); 
                    if (this.stats.xp >= this.stats.nextLevelXp) {
                        this.startLevelUpSequence();
                    }
                }
            }
        });
        this.xpOrbs = this.xpOrbs.filter(o => o.parent);
    }

    handleCollisions(delta: number) {
        if (this.player.invulnTimer <= 0) {
            for (const e of this.enemies) {
                 if (e.isDead || e.destroyed) continue;
                 const dx = this.player.x - e.x;
                 const dy = this.player.y - e.y;
                 const dist = Math.sqrt(dx * dx + dy * dy);
                 if (dist < (this.player.radius + e.radius)) {
                     const dmg = e.isBoss ? 20 + this.wave : 5 + (this.wave * 0.5);
                     this.player.hp -= dmg; 
                     this.player.invulnTimer = 30; 
                     this.spawnText("-HP", this.player.x, this.player.y - 30, 0xff0000);
                     if (this.player.hp <= 0) {
                         this.player.hp = 0;
                         this.state = GameState.GAME_OVER;
                         this.onGameStateChange(GameState.GAME_OVER);
                     }
                     break; 
                 }
            }
        }

        for (const b of this.bullets) {
            if (b.isDead || b.destroyed) continue;
            
            for (const e of this.enemies) {
                if (e.isDead || e.destroyed) continue;
                if (b.hitList.has(this.getObjectId(e))) continue;

                let hitRadius = b.radius;
                // Scale hitbox for wind/water
                if (b.element === ElementType.WIND || b.element === ElementType.WATER) hitRadius *= b.scale.x; 
                
                if (b.ownerId.startsWith('art_track') && b.state !== 'SLASH') continue;

                const dx = b.x - e.x;
                const dy = b.y - e.y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < (hitRadius + e.radius)) {
                    this.applyDamage(e, b);
                    b.hitList.add(this.getObjectId(e));
                    
                    b.pierce--;
                    if (b.pierce <= 0) {
                        this.killBullet(b);
                        break; 
                    }
                }
            }
        }
    }

    getObjectId(obj: any): number {
        if (!obj._tempId) obj._tempId = Math.random();
        return obj._tempId;
    }

    applyDamage(e: Entity, b: Bullet) {
        let dmg = b.damage;

        if (b.element === ElementType.WIND) {
            const angle = Math.atan2(e.y - b.y, e.x - b.x);
            // More knockback
            e.knockbackVx += Math.cos(angle) * 20;
            e.knockbackVy += Math.sin(angle) * 20;
        }

        if (b.element === ElementType.FIRE) {
            e.isBurning = true;
            // Water cuts fire check
            if (e.isWet) { e.isBurning = false; }
        }

        if (b.element === ElementType.WATER) {
            e.isWet = true;
            const angle = Math.atan2(e.y - b.y, e.x - b.x);
            e.knockbackVx += Math.cos(angle) * 5; 
            e.knockbackVy += Math.sin(angle) * 5;
            
            // Interaction: Water Extinguishes Fire (Steam)
            if (e.isBurning) { 
                e.isBurning = false; 
                dmg *= 1.5; // Steam Damage Bonus
                this.spawnText("STEAM!", e.x, e.y - 30, 0xffffff);
                this.spawnParticle(e.x, e.y, 0xaaaaaa, 5);
            }
        }

        if (dmg > 0) {
            e.hp -= dmg;
            e.hitFlashTimer = 5; 
            
            this.damageTextCooldown--;
            if (this.damageTextCooldown <= 0 || dmg > 50) { 
                this.spawnText(Math.round(dmg).toString(), e.x, e.y - 20, 0xffffff);
                this.damageTextCooldown = 2; 
            }
        }

        if (Math.random() > 0.5) this.spawnParticle(e.x, e.y, b.color, 2);
        
        if (e.hp <= 0 && !e.isDead) this.killEnemy(e);
    }

    killEnemy(e: Entity) {
        if (e.isDead || e.destroyed) return;
        e.isDead = true;
        this.world.removeChild(e);
        
        // --- Enhanced XP Drop System ---
        const orb = new Graphics() as XPOrb;
        
        const roll = Math.random() * 100 + (this.wave * 0.5); // Increase quality chance with wave
        
        let color = COLORS.XP_GRAY;
        let val = 1;
        let tier = 0;
        let size = 5;

        // Tiers: Gray -> Green -> Blue -> Orange -> Red -> Prism
        if (roll > 150) { color = COLORS.XP_PRISM; val = 100; tier = 5; size = 10; }
        else if (roll > 110) { color = COLORS.XP_RED; val = 50; tier = 4; size = 9; }
        else if (roll > 80) { color = COLORS.XP_ORANGE; val = 20; tier = 3; size = 8; }
        else if (roll > 50) { color = COLORS.XP_BLUE; val = 10; tier = 2; size = 7; }
        else if (roll > 20) { color = COLORS.XP_GREEN; val = 5; tier = 1; size = 6; }
        
        // Base value scaling
        val *= (1 + this.wave * 0.1);

        orb.poly([0, -size, size, 0, 0, size, -size, 0]).fill(color);
        // Add glow for high tiers
        if (tier >= 3) orb.circle(0,0, size+2).stroke({width: 1, color: 0xffffff, alpha: 0.5});

        orb.x = e.x;
        orb.y = e.y;
        orb.value = val;
        orb.tier = tier;
        
        this.xpOrbs.push(orb);
        this.world.addChild(orb);

        if (this.wave === 100 && e.isBoss) { 
            this.state = GameState.VICTORY;
            this.onGameStateChange(GameState.VICTORY);
        }
    }

    startLevelUpSequence() {
        this.state = GameState.PRE_LEVEL_UP;
        this.preLevelUpTimer = 60; 
        this.onGameStateChange(GameState.PRE_LEVEL_UP);
        this.spawnText("LEVEL UP!", this.player.x, this.player.y - 50, 0xffd700);
    }

    triggerLevelUpUI() {
        this.state = GameState.LEVEL_UP;
        this.onGameStateChange(GameState.LEVEL_UP);
        this.stats.level++;
        this.stats.xp = 0;
        // Exponential XP curve
        this.stats.nextLevelXp = Math.floor(20 + Math.pow(this.stats.level, 2.2) * 5);
    }

    spawnText(text: string, x: number, y: number, color: number) {
        if (this.floatingTexts.length > 50) return; 

        const t = new Text({
            text: text,
            style: {
                fontFamily: 'Courier New', 
                fontSize: 14,
                fill: color,
                stroke: { color: 0x000000, width: 2 },
                fontWeight: 'bold'
            }
        });
        t.x = x;
        t.y = y;
        this.world.addChild(t);
        
        this.floatingTexts.push({
            container: t,
            x: x,
            y: y,
            life: 40,
            velocityY: -1
        });
    }

    spawnParticle(x: number, y: number, color: number, count = 3, upward = false) {
        if (this.particles.length > 300) return; 

        for(let i=0; i<count; i++) {
            const p = new Graphics() as Particle;
            p.rect(0,0, 3, 3).fill(color); 
            p.x = x;
            p.y = y;
            if (upward) {
                p.vx = (Math.random()-0.5) * 2;
                p.vy = -Math.random() * 3 - 1; 
            } else {
                p.vx = (Math.random()-0.5) * 4;
                p.vy = (Math.random()-0.5) * 4;
            }
            p.life = 30;
            p.maxLife = 30;
            p.isStatic = false;
            
            this.particles.push(p);
            this.world.addChild(p);
        }
    }

    addCard(card: CardDef) {
        if (card.type === CardType.STAT && card.statBonus) {
            if (card.statBonus.hpPercent) {
                const increase = this.stats.maxHp * card.statBonus.hpPercent;
                this.stats.maxHp += increase;
                this.player.maxHp = this.stats.maxHp;
                this.player.hp += increase; 
            }
            if (card.statBonus.dmgPercent) this.stats.damageMultiplier *= (1 + card.statBonus.dmgPercent);
            if (card.statBonus.pickupPercent) this.stats.pickupRange *= (1 + card.statBonus.pickupPercent);
        } else {
            this.stats.inventory.push(card);
        }
    }

    reorderInventory(newOrder: CardDef[]) {
        this.stats.inventory = newOrder;
    }

    resume() {
        this.state = GameState.PLAYING;
    }
    
    // --- GM / DEBUG METHODS ---
    debugSetWave(w: number) {
        this.wave = w;
        this.waveTotalEnemies = Math.floor(20 + Math.pow(this.wave, 1.2) * 5);
        this.spawnText(`GM: WAVE ${w}`, this.player.x, this.player.y - 50, 0xff00ff);
    }
    
    debugRemoveCard(index: number) {
        if (index >= 0 && index < this.stats.inventory.length) {
            this.stats.inventory.splice(index, 1);
        }
    }

    destroy() {
        try {
            this.app.destroy({ removeView: true } as any);
        } catch(e) { console.error(e) }
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mousedown', this.handleMouseDown);
    }
}
