
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
        const sizeFactor = 1 + Math