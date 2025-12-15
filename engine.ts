
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
    maxLife: number; // Added for lerp
    type?: 'storm'; // Type for special rendering
    onUpdate: (g: Graphics, life: number, maxLife: number) => void;
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
            backgroundColor: 0x0f172a, // Matches CSS
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
            maxLife: 15,
            onUpdate: (g, l, ml) => { g.alpha = l / ml; }
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
        const sizeFactor = 1 + Math.min(2, this.wave * 0.05); 
        
        let color = 0x88cc88;
        let speed = 2;
        let hp = 10 + (this.wave * 2); 
        let radius = 10;
        let xpValue = 1;

        switch(type) {
            case 'slime':
                g.circle(0,0,10).fill(color);
                speed = 1.5 + Math.random();
                break;
            case 'bat':
                color = 0x5555ff;
                g.moveTo(-10, 0).lineTo(0, 5).lineTo(10, 0).lineTo(0, -5).fill(color);
                speed = 3 + Math.random();
                hp *= 0.8;
                xpValue = 2;
                radius = 8;
                break;
            case 'skull':
                color = 0xcccccc;
                g.rect(-8, -8, 16, 16).fill(color);
                g.rect(-3, 2, 2, 4).fill(0x000000); // eye
                g.rect(1, 2, 2, 4).fill(0x000000); // eye
                speed = 1 + Math.random() * 0.5;
                hp *= 2.5;
                xpValue = 5;
                radius = 12;
                break;
            case 'eye':
                color = 0xff5555;
                g.circle(0,0,14).fill(color);
                g.circle(0,0,6).fill(0xffff00); // pupil
                speed = 2.5;
                hp *= 1.5;
                xpValue = 8;
                radius = 14;
                break;
        }

        cont.addChild(g);
        cont.x = x;
        cont.y = y;
        cont.baseScale = sizeFactor;
        cont.scale.set(sizeFactor);
        
        cont.hp = hp * sizeFactor;
        cont.maxHp = cont.hp;
        cont.radius = radius * sizeFactor;
        cont.isDead = false;
        cont.vx = 0; cont.vy = 0;
        cont.knockbackVx = 0; cont.knockbackVy = 0;
        cont.enemyType = type;
        cont.animOffset = Math.random() * 100;
        cont.isBoss = false;

        cont.isBurning = false; cont.burnTimer = 0;
        cont.isWet = false; cont.wetTimer = 0;
        cont.isElectrified = false;
        cont.hitByLightningYellow = 0;
        cont.hitByLightningBlue = 0;
        cont.hitFlashTimer = 0;

        this.enemies.push(cont);
        this.world.addChild(cont);
    }

    handleWeapons(delta: number) {
        // Build the spell chain from inventory
        let activeArtifact: CardDef | null = null;
        let modifiers: ActiveEffect[] = [];
        let statBuffs = { frequency: 1, range: 1, speed: 1, damage: 1 };
        
        // We only process weapons if we have them. 
        // In the inventory array, we execute logically sequentially but they operate in parallel timelines (cooldowns are per artifact).
        // However, modifiers apply to the NEXT artifact in the chain.
        
        for (let i = 0; i < this.stats.inventory.length; i++) {
            const card = this.stats.inventory[i];
            
            if (card.type === CardType.EFFECT) {
                if (card.effectConfig) {
                    modifiers.push({ 
                        logic: card.effectConfig.logic, 
                        count: card.effectConfig.influenceCount 
                    });
                }
            } else if (card.type === CardType.BUFF) {
                if (card.buffConfig) {
                    if (card.buffConfig.frequency) statBuffs.frequency += card.buffConfig.frequency;
                    if (card.buffConfig.range) statBuffs.range += card.buffConfig.range;
                    if (card.buffConfig.speed) statBuffs.speed += card.buffConfig.speed;
                }
            } else if (card.type === CardType.ARTIFACT) {
                // Found an artifact, trigger it using accumulated modifiers
                this.updateArtifact(card, modifiers, statBuffs, delta);
                
                // Reset modifiers for next artifact
                modifiers = []; 
                statBuffs = { frequency: 1, range: 1, speed: 1, damage: 1 };
            }
        }
    }

    updateArtifact(card: CardDef, modifiers: ActiveEffect[], buffs: any, delta: number) {
        if (!card.artifactConfig) return;
        
        const config = card.artifactConfig;
        
        // Use a persistent store for cooldowns on the card object itself (runtime hack)
        const runtime = card as any;
        if (!runtime.cooldownTimer) runtime.cooldownTimer = 0;
        
        // Apply Buffs
        const finalCooldown = Math.max(5, config.cooldown / buffs.frequency);
        
        runtime.cooldownTimer -= delta;
        
        if (runtime.cooldownTimer <= 0) {
            // Find Target
            const target = this.getNearestEnemy(this.player.x, this.player.y, 400 * buffs.range);
            
            // Fire!
            // Handle Multi-cast (Double effect)
            let castCount = 1;
            const doubleMod = modifiers.find(m => m.logic === 'double');
            if (doubleMod) castCount += doubleMod.count;

            for(let c=0; c<castCount; c++) {
                 // Add small delay for multi-cast
                 if (c > 0) {
                     this.delayedActions.push({
                         timer: c * 5,
                         action: () => this.fireWeapon(card, modifiers, buffs, target)
                     });
                 } else {
                     this.fireWeapon(card, modifiers, buffs, target);
                 }
            }

            runtime.cooldownTimer = finalCooldown;
        }
    }

    fireWeapon(card: CardDef, modifiers: ActiveEffect[], buffs: any, target: Entity | null) {
        if (!card.artifactConfig) return;
        const config = card.artifactConfig;

        const baseDmg = config.baseDamage * this.stats.damageMultiplier * buffs.damage;
        
        // Modifiers Logic
        const fan = modifiers.find(m => m.logic === 'fan');
        const splitBack = modifiers.find(m => m.logic === 'split_back');
        const ring = modifiers.find(m => m.logic === 'ring');
        const wobble = modifiers.find(m => m.logic === 'wobble');
        const giant = modifiers.find(m => m.logic === 'giant');
        const track = modifiers.find(m => m.logic === 'track');

        const giantCount = giant ? giant.count : 0;
        const scale = 1 + (giantCount * 0.5);

        // Calculate Direction
        let angle = 0;
        if (target) {
            angle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
        } else {
            // Random or movement direction
            if (this.joystickInput.x !== 0 || this.joystickInput.y !== 0) {
                angle = Math.atan2(this.joystickInput.y, this.joystickInput.x);
            } else {
                angle = Math.random() * Math.PI * 2;
            }
        }

        // Projectiles count
        let projectiles = 1;
        let arc = 0;
        
        if (fan) {
            projectiles += 2 + fan.count; // Silver=3 total, Gold=4 total, Prism=5
            arc = Math.PI / 3;
        }
        if (ring) {
            projectiles = 8 + ring.count * 2;
            arc = Math.PI * 2;
        }

        const startAngle = angle - arc/2;
        const step = projectiles > 1 ? arc / (projectiles - 1) : 0;

        // Extra backwards shots
        const backShots = splitBack ? splitBack.count : 0;

        // Fire Function
        const spawnBullet = (a: number) => {
             const b = new Container() as Bullet;
             const g = new Graphics();

             // Visuals based on config
             b.color = config.color; // CRITICAL: Save color to bullet for logic
             
             // --- Updated Projectile Drawing ---
             if (config.projectileType === 'lightning') {
                 // Lightning is handled in updateBullets for animation, but we need a base hit area
                 g.circle(0,0,15 * scale).fill({ color: 0xffffff, alpha: 0.01 }); // invisible hitbox
                 // We will draw the bolt dynamically
             }
             else if (config.projectileType === 'water_snake') {
                 g.circle(0,0, 10 * scale).fill(config.color);
             }
             else if (config.projectileType === 'area') {
                 // Initial burst visual
                 g.circle(0,0, 40 * scale * buffs.range).stroke({ width: 2, color: config.color });
                 g.circle(0,0, 40 * scale * buffs.range).fill({ color: config.color, alpha: 0.2 });
             } 
             else {
                 // Standard
                 g.circle(0,0, 6 * scale).fill(config.color);
                 g.circle(0,0, 4 * scale).fill(0xffffff); // core
             }

             b.addChild(g);
             b.x = this.player.x;
             b.y = this.player.y;
             b.vx = Math.cos(a) * 5 * buffs.speed;
             b.vy = Math.sin(a) * 5 * buffs.speed;
             b.damage = baseDmg;
             b.element = config.element;
             b.duration = 60 * buffs.range; // Range affects duration for projectiles
             b.maxDuration = b.duration;
             b.radius = 10 * scale;
             if (config.projectileType === 'area') b.radius = 40 * scale * buffs.range;
             
             b.ownerId = card.id;
             b.isDead = false;
             b.pierce = 1;
             if (config.projectileType === 'area' || config.projectileType === 'beam' || config.projectileType === 'lightning') b.pierce = 999;
             if (giant) b.pierce += 2;

             b.hitList = new Set();
             b.trailTimer = 0;
             b.color = config.color; // Save tracking color
             
             // Logic Flags
             b.isTracking = !!track;
             b.isWobble = !!wobble;
             b.wobblePhase = 0;
             b.giantCount = giantCount;
             
             // Type Specific Init
             if (config.projectileType === 'lightning') {
                 b.duration = 15; // Short life for lightning visual
                 b.pierce = 999;
                 // Lightning doesn't move conventionally
                 b.vx = 0; b.vy = 0;
                 // Find chain targets? Simplified: hits area line
                 // For now, let's make it a "Bolt" that hits the target instantly or travels super fast
                 b.vx = Math.cos(a) * 20;
                 b.vy = Math.sin(a) * 20;
             }

             this.bullets.push(b);
             this.world.addChild(b);
        };

        // Main Volley
        if (ring) {
             for(let j=0; j<projectiles; j++) {
                 spawnBullet(angle + (j * (Math.PI*2/projectiles)));
             }
        } else {
             for(let j=0; j<projectiles; j++) {
                 spawnBullet(startAngle + (j * step));
             }
        }

        // Backwards Volley
        if (backShots > 0) {
            for(let k=0; k<backShots; k++) {
                spawnBullet(angle + Math.PI + (Math.random()-0.5)*0.5);
            }
        }
    }

    getNearestEnemy(x: number, y: number, range: number): Entity | null {
        let nearest: Entity | null = null;
        let minD = range * range;
        
        for (const e of this.enemies) {
            if (e.isDead) continue;
            const d = (e.x - x)**2 + (e.y - y)**2;
            if (d < minD) {
                minD = d;
                nearest = e;
            }
        }
        return nearest;
    }

    updateEnemies(delta: number) {
        const px = this.player.x;
        const py = this.player.y;

        for (const e of this.enemies) {
            if (e.isDead) continue;

            // Behavior
            let dx = px - e.x;
            let dy = py - e.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Normalize
            if (dist > 0) {
                dx /= dist;
                dy /= dist;
            }

            // Move
            let spd = 0.5; // Base speed
            // If knockback
            if (Math.abs(e.knockbackVx) > 0.1 || Math.abs(e.knockbackVy) > 0.1) {
                e.x += e.knockbackVx * delta;
                e.y += e.knockbackVy * delta;
                e.knockbackVx *= 0.9;
                e.knockbackVy *= 0.9;
            } else {
                // Normal move
                e.x += dx * spd * delta;
                e.y += dy * spd * delta;
                
                // Avoidance (soft collision between enemies)
                // Performance heavy, skip for now or simple check
            }

            // Visuals
            e.animOffset += delta * 0.1;
            const bounce = Math.sin(e.animOffset) * 5;
            e.getChildAt(0).y = bounce;

            // Status Effects
            if (e.hitFlashTimer > 0) {
                e.hitFlashTimer -= delta;
                e.tint = 0xffffff;
            } else {
                e.tint = 0xffffff; // Reset
                if (e.hitByLightningYellow > 0) e.tint = 0xffffaa;
                if (e.hitByLightningBlue > 0) e.tint = 0xaaaaFF;
            }

            // Decrease Status Timers
            if (e.hitByLightningYellow > 0) e.hitByLightningYellow -= delta;
            if (e.hitByLightningBlue > 0) e.hitByLightningBlue -= delta;

            // Boss Logic
            if (e.isBoss) {
                if (e.bossActionTimer && e.bossActionTimer > 0) {
                    e.bossActionTimer -= delta;
                } else {
                    // Boss Attack
                    // Spawn simple bullets
                    for(let i=0; i<8; i++) {
                        const a = (Math.PI*2/8)*i + e.animOffset;
                        const b = new Container() as Bullet;
                        const bg = new Graphics();
                        bg.circle(0,0,5).fill(0xff0000);
                        b.addChild(bg);
                        b.x = e.x; b.y = e.y;
                        b.vx = Math.cos(a)*3; b.vy = Math.sin(a)*3;
                        b.damage = 10;
                        b.element = ElementType.VOID;
                        b.duration = 200;
                        b.maxDuration = 200;
                        b.radius = 5;
                        b.ownerId = 'boss';
                        b.isDead = false;
                        b.pierce = 1;
                        b.hitList = new Set();
                        b.color = 0xff0000;
                        b.trailTimer = 0;
                        b.giantCount = 0;
                        // Add to Enemy Bullets list? 
                        // For simplicity, we don't have enemy bullets hitting player yet in this simplified engine
                        // Just collision damage.
                    }
                    e.bossActionTimer = 180;
                }
            }
        }
    }

    updateBullets(delta: number) {
        for (const b of this.bullets) {
            if (b.isDead) continue;

            b.duration -= delta;
            if (b.duration <= 0) {
                b.isDead = true;
                continue;
            }

            // Movement Logic
            if (b.isWobble) {
                b.wobblePhase = (b.wobblePhase || 0) + 0.2 * delta;
                const perpX = -b.vy;
                const perpY = b.vx;
                const mag = Math.sin(b.wobblePhase) * 2;
                b.x += b.vx * delta + perpX * mag * 0.1;
                b.y += b.vy * delta + perpY * mag * 0.1;
            } 
            else if (b.isTracking && !b.target) {
                // Find target if none
                b.target = this.getNearestEnemy(b.x, b.y, 300);
                b.x += b.vx * delta;
                b.y += b.vy * delta;
            }
            else if (b.isTracking && b.target && !b.target.isDead) {
                // Homing
                const dx = b.target.x - b.x;
                const dy = b.target.y - b.y;
                const angle = Math.atan2(dy, dx);
                // Steer
                const currentAngle = Math.atan2(b.vy, b.vx);
                // Simple lerp angle?
                b.vx = Math.cos(angle) * 5; // simplified
                b.vy = Math.sin(angle) * 5;
                b.x += b.vx * delta;
                b.y += b.vy * delta;
            }
            else {
                b.x += b.vx * delta;
                b.y += b.vy * delta;
            }

            // Visual Updates (Trails, etc)
            b.trailTimer += delta;
            if (b.trailTimer > 3) {
                this.spawnParticle(b.x, b.y, b.color, 0.5, true);
                b.trailTimer = 0;
            }

            // Special Renderer for Lightning
            // We want the lightning to look like a zigzag from origin to current point, or just chaotic
            if (b.element === ElementType.LIGHTNING || b.element === ElementType.LIGHTNING_BLUE) {
                const g = b.getChildAt(0) as Graphics;
                g.clear();
                g.moveTo(0,0);
                
                // Draw a zigzag tail behind movement
                const tailLen = 30;
                // Randomized points
                g.lineTo(-b.vx * 2 + (Math.random()-0.5)*10, -b.vy * 2 + (Math.random()-0.5)*10);
                g.lineTo(-b.vx * 4, -b.vy * 4);
                
                // Use the configured bullet color!
                g.stroke({ width: 2 + b.giantCount, color: b.color });
            }
        }
    }

    updateParticles(delta: number) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
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

    spawnParticle(x: number, y: number, color: number, scale: number = 1, staticP: boolean = false) {
        if (this.particles.length > 200) return; // limit

        const p = new Graphics() as Particle;
        p.rect(-2, -2, 4, 4).fill(color);
        p.x = x; 
        p.y = y;
        p.scale.set(scale);
        p.maxLife = 20 + Math.random() * 20;
        p.life = p.maxLife;
        p.isStatic = staticP;
        
        if (!staticP) {
            const a = Math.random() * Math.PI * 2;
            const s = Math.random() * 2;
            p.vx = Math.cos(a) * s;
            p.vy = Math.sin(a) * s;
        } else {
            p.vx = 0; p.vy = 0;
        }

        this.particles.push(p);
        this.world.addChild(p);
    }

    updateFloatingTexts(delta: number) {
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.life -= delta;
            ft.container.y -= ft.velocityY * delta;
            ft.container.alpha = Math.min(1, ft.life / 20);
            
            if (ft.life <= 0) {
                ft.container.destroy();
                this.floatingTexts.splice(i, 1);
            }
        }
    }
    
    updateTempEffects(delta: number) {
        for (let i = this.tempEffects.length - 1; i >= 0; i--) {
            const eff = this.tempEffects[i];
            eff.life -= delta;
            
            if (eff.type === 'storm') {
                // Lightning Storm logic: Flash random bolts inside area
                eff.container.clear();
                eff.container.circle(0,0, 100).fill({ color: 0xFFFFFF, alpha: 0.1 });
                
                // Draw 3-5 random bolts
                for(let k=0; k<3; k++) {
                    const angle = Math.random() * Math.PI * 2;
                    const len = Math.random() * 90;
                    const sx = Math.cos(angle) * (len * 0.2);
                    const sy = Math.sin(angle) * (len * 0.2);
                    const ex = Math.cos(angle) * len;
                    const ey = Math.sin(angle) * len;
                    
                    eff.container.moveTo(sx, sy);
                    // Midpoint jitter
                    eff.container.lineTo((sx+ex)/2 + (Math.random()-0.5)*20, (sy+ey)/2 + (Math.random()-0.5)*20);
                    eff.container.lineTo(ex, ey);
                    
                    const col = Math.random() > 0.5 ? 0xffd700 : 0x2979ff;
                    eff.container.stroke({ width: 2, color: col });
                }
            }

            eff.onUpdate(eff.container, eff.life, eff.maxLife);
            
            if (eff.life <= 0) {
                eff.container.destroy();
                this.tempEffects.splice(i, 1);
            }
        }
    }

    spawnText(str: string, x: number, y: number, color: number) {
        if (this.floatingTexts.length > 50) return;
        
        const t = new Text({
            text: str,
            style: {
                fontFamily: 'Courier New',
                fontSize: 16,
                fill: color,
                stroke: { color: 0x000000, width: 3 },
                fontWeight: 'bold'
            }
        });
        t.anchor.set(0.5);
        t.x = x;
        t.y = y;
        this.world.addChild(t);
        
        this.floatingTexts.push({
            container: t,
            x, y,
            life: 40,
            velocityY: 1
        });
    }

    handleCollisions(delta: number) {
        // Player vs Obstacles (Simple bounds)
        // Skip for now, open field
        
        // Bullets vs Enemies
        for (const b of this.bullets) {
            if (b.isDead) continue;
            
            // Optimization: Spatial hash would be better
            for (const e of this.enemies) {
                if (e.isDead) continue;
                if (b.hitList.has(e.uid)) continue; // e.uid is internal PIXI id? No, use object ref check or add ID

                const dx = b.x - e.x;
                const dy = b.y - e.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist < (b.radius + e.radius)) {
                    // HIT
                    this.applyDamage(e, b.damage, b.element);
                    
                    // Logic: Tracking Hits for Synergy
                    if (b.element === ElementType.LIGHTNING) {
                        e.hitByLightningYellow = 60; // 1 second window
                    }
                    if (b.element === ElementType.LIGHTNING_BLUE) {
                        e.hitByLightningBlue = 60;
                    }

                    // CHECK SYNERGY: THUNDERSTORM
                    if (e.hitByLightningYellow > 0 && e.hitByLightningBlue > 0) {
                        this.triggerThunderstorm(e);
                        // Reset timers so we don't trigger every frame
                        e.hitByLightningYellow = 0;
                        e.hitByLightningBlue = 0;
                    }

                    // Knockback
                    const angle = Math.atan2(dy, dx);
                    e.knockbackVx = -Math.cos(angle) * 200 * (10 / e.radius); // lighter enemies fly further
                    e.knockbackVy = -Math.sin(angle) * 200 * (10 / e.radius);
                    
                    // Pierce logic
                    if (!b.hitList.has(e.uid)) {
                        b.pierce--;
                        // We use the object itself as key if we can, or just add a prop
                        // For simplicity, let's assume b.hitList stores unique IDs we assign or PIXI uniqueId
                        // using checking existence
                    }
                    
                    if (b.pierce <= 0) {
                        b.isDead = true;
                        break;
                    }
                }
            }
        }

        // Player vs Enemies (Contact Damage)
        if (this.player.invulnTimer <= 0) {
            for (const e of this.enemies) {
                if (e.isDead) continue;
                const dx = this.player.x - e.x;
                const dy = this.player.y - e.y;
                if (Math.sqrt(dx*dx + dy*dy) < (this.player.radius + e.radius)) {
                    this.player.hp -= 5; // Fixed damage for now
                    this.player.invulnTimer = 30; // 0.5s invuln
                    this.spawnText("-5", this.player.x, this.player.y - 20, 0xff0000);
                    
                    if (this.player.hp <= 0) {
                        this.onGameStateChange(GameState.GAME_OVER);
                    }
                    break; 
                }
            }
        }
    }

    triggerThunderstorm(target: Entity) {
        // Visual: Area Effect
        const g = new Graphics();
        g.x = target.x;
        g.y = target.y;
        this.world.addChild(g);
        
        this.tempEffects.push({
            container: g,
            life: 30, // 0.5 sec duration
            maxLife: 30,
            type: 'storm',
            onUpdate: (gr, life, maxLife) => {
                 gr.alpha = life/maxLife;
            }
        });

        this.spawnText("STORM!", target.x, target.y - 30, 0xffd700);

        // Logic: Damage Area
        // Instant damage to all nearby
        for (const e of this.enemies) {
            if(e.isDead) continue;
            const d = Math.sqrt((e.x - target.x)**2 + (e.y - target.y)**2);
            if (d < 100) {
                this.applyDamage(e, 50 * this.stats.damageMultiplier, ElementType.LIGHTNING);
            }
        }
    }

    applyDamage(e: Entity, dmg: number, type: ElementType) {
        e.hp -= dmg;
        e.hitFlashTimer = 5;
        e.tint = 0xff0000;
        
        if (Math.random() > 0.5) { // lessen text spam
            this.spawnText(Math.floor(dmg).toString(), e.x, e.y - e.radius - 10, 0xffffff);
        }

        if (e.hp <= 0) {
            e.isDead = true;
            e.visible = false; 
            // Spawn XP
            this.spawnXP(e.x, e.y, (e as any).xpValue || 1);
            
            // Clean up later or pool
            e.destroy(); 
            this.enemies = this.enemies.filter(en => en !== e);
            
            if (e.isBoss) {
                 this.spawnText("VICTORY?", this.player.x, this.player.y - 50, 0xffff00);
                 // maybe drop chest
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
        xp.vx = 0; xp.vy = 0;
        
        this.xpOrbs.push(xp);
        this.world.addChild(xp);
    }

    updateXP(delta: number) {
        const rangeSq = this.stats.pickupRange ** 2;
        
        for (let i = this.xpOrbs.length - 1; i >= 0; i--) {
            const orb = this.xpOrbs[i];
            const dx = this.player.x - orb.x;
            const dy = this.player.y - orb.y;
            const distSq = dx*dx + dy*dy;
            
            if (distSq < rangeSq || orb.isMagnetized) {
                orb.isMagnetized = true;
                const dist = Math.sqrt(distSq);
                const spd = 8 * delta; // fast suck
                orb.x += (dx / dist) * spd;
                orb.y += (dy / dist) * spd;
                
                if (dist < 10) {
                    this.gainXP(orb.value);
                    orb.destroy();
                    this.xpOrbs.splice(i, 1);
                }
            }
        }
    }

    gainXP(amount: number) {
        this.stats.xp += amount;
        if (this.stats.xp >= this.stats.nextLevelXp) {
            this.stats.xp -= this.stats.nextLevelXp;
            this.stats.level++;
            this.stats.nextLevelXp = Math.floor(this.stats.nextLevelXp * 1.5);
            
            this.state = GameState.PRE_LEVEL_UP;
            this.preLevelUpTimer = 60; // 1 second animation
            // Visual Flair
            this.spawnText("LEVEL UP!", this.player.x, this.player.y - 50, 0xffff00);
            
            this.onGameStateChange(GameState.PRE_LEVEL_UP);
        }
    }

    triggerLevelUpUI() {
        this.state = GameState.LEVEL_UP;
        this.onGameStateChange(GameState.LEVEL_UP);
    }

    addCard(card: CardDef) {
        this.stats.inventory.push(card);
        // Apply immediate stat cards
        if (card.type === CardType.STAT && card.statBonus) {
            if (card.statBonus.hpPercent) {
                 this.player.maxHp *= (1 + card.statBonus.hpPercent);
                 this.player.hp = this.player.maxHp; // Heal on level up
            }
            if (card.statBonus.dmgPercent) this.stats.damageMultiplier += card.statBonus.dmgPercent;
        }
        
        // Resume handled by UI
    }

    // --- GM Methods ---
    debugRemoveCard(index: number) {
        this.stats.inventory.splice(index, 1);
    }
    
    debugSetWave(w: number) {
        this.wave = w;
        this.waveTotalEnemies = 20 + w*5;
        this.spawnText(`GM: WAVE ${w}`, this.player.x, this.player.y, 0xff00ff);
    }

    reorderInventory(newInv: CardDef[]) {
        this.stats.inventory = newInv;
    }

    resume() {
        this.state = GameState.PLAYING;
    }
    
    destroy() {
        this.app.destroy(true, { children: true });
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mousedown', this.handleMouseDown);
    }
}
