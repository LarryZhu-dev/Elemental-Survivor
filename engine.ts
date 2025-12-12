import { Application, Container, Graphics, Text, Ticker } from 'pixi.js';
import { CardDef, CardType, ElementType, EnemyDef, GameState, MapType, PlayerStats, Rarity } from './types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './constants';

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
    // Player Specific
    invulnTimer: number;
    moveTarget?: {x: number, y: number};
    // Visuals
    hitFlashTimer: number;
}

type Bullet = Container & {
    vx: number;
    vy: number;
    damage: number;
    element: ElementType;
    duration: number;
    radius: number;
    ownerId: string;
    isDead: boolean;
    // Specific logic
    isTracking?: boolean;
    pierce: number;
    hitList: Set<number>; // Enemy IDs hit
    // Visuals
    trailTimer: number; // For spawning particle trails
    color: number; // For particle trails
    
    // Persistent Weapon State
    state?: string; // For Glaive: 'IDLE', 'SEEK', 'RETURN'
    target?: Entity | null;
    orbitAngle?: number;
    
    // Logic modifiers
    isWobble?: boolean;
    wobblePhase?: number;
}

type Particle = Graphics & {
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    isStatic: boolean; // Does it move?
}

type XPOrb = Graphics & {
    value: number;
    vx: number;
    vy: number;
    isMagnetized?: boolean;
}

interface DelayedAction {
    timer: number;
    action: () => void;
}

interface ActiveEffect {
    logic: string;
    count: number; // How many more cards it influences
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
            pickupRange: 100,
            inventory: []
        };

        // Add initial weapon
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
            resolution: window.devicePixelRatio || 1,
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
        // Initial generic projectile
        const starter: CardDef = {
            id: 'starter',
            name: '初始法球',
            description: '基础攻击',
            type: CardType.ARTIFACT,
            rarity: Rarity.SILVER,
            iconColor: '#00ffff',
            artifactConfig: {
                cooldown: 50,
                baseDamage: 4, 
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
        // Body (Blue Robe)
        g.rect(-6, -8, 12, 16).fill(0x3b82f6); 
        // Hood/Head shadow
        g.rect(-6, -12, 12, 4).fill(0x1d4ed8);
        // Face
        g.rect(-4, -10, 8, 4).fill(0xffccaa);
        // Belt
        g.rect(-6, 0, 12, 2).fill(0xfca5a5);
        // Staff (Brown)
        g.rect(6, -10, 2, 20).fill(0x78350f);
        // Staff Gem (Red)
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
        this.waveTotalEnemies = 15; 
        this.waveDelayTimer = 0;

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
        // Custom fast seeded random function for consistency
        let seed = (cx * 374761393) ^ (cy * 668265263);
        const seededRandom = () => {
            seed = (seed ^ 61) ^ (seed >> 16);
            seed += (seed << 3);
            seed = seed ^ (seed >> 4);
            seed *= 668265263;
            seed = seed ^ (seed >> 15);
            return (seed >>> 0) / 4294967296;
        };

        const count = 10; // Obstacles per chunk
        for(let i=0; i<count; i++) {
             const obs = new Graphics();
             const type = seededRandom();
             const ox = (cx * CHUNK_SIZE) + seededRandom() * CHUNK_SIZE;
             const oy = (cy * CHUNK_SIZE) + seededRandom() * CHUNK_SIZE;

             if (type < 0.3) {
                 // Pixel Tree
                 obs.rect(-4, 0, 8, 12).fill(0x5c4033); // Trunk
                 obs.rect(-12, -24, 24, 24).fill(0x228b22); // Leaves
             } else if (type < 0.6) {
                 // Pixel Rock
                 obs.rect(-10, -5, 20, 10).fill(0x555555);
                 obs.rect(-5, -10, 10, 5).fill(0x777777);
             } else {
                 // Wall Segment
                 obs.rect(-10, -30, 20, 60).fill(0x8b4513);
             }
             
             obs.x = ox;
             obs.y = oy;
             
             this.obstacles.push(obs);
             this.world.addChild(obs);
             // Keep z-index lower
             obs.zIndex = 5;
        }
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
        
        // Click to move logic
        const worldX = (e.clientX - SCREEN_WIDTH/2) + this.player.x;
        const worldY = (e.clientY - SCREEN_HEIGHT/2) + this.player.y;
        
        this.player.moveTarget = { x: worldX, y: worldY };
        
        // Spawn indicator
        const marker = new Graphics();
        marker.rect(-2, -2, 4, 4).fill(0xffffff);
        marker.x = worldX;
        marker.y = worldY;
        this.world.addChild(marker);
        setTimeout(() => {
            marker.parent?.removeChild(marker);
            marker.destroy(); // Memory Fix
        }, 300);
    }

    update(ticker: Ticker) {
        const delta = ticker.deltaTime;
        
        this.updateParticles(delta);

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

        // Map
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

        if (this.player.moveTarget) {
            const dx = this.player.moveTarget.x - this.player.x;
            const dy = this.player.moveTarget.y - this.player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 5) {
                // Reduced speed to 80% (4) as requested
                const speed = 4 * delta; 
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
                this.waveTotalEnemies = Math.floor(10 + this.wave * 2.5);
                
                if (this.wave % 10 === 0) {
                    this.onBossWarning(`Level ${this.wave} BOSS`);
                    this.spawnEnemy(true);
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
             if (this.enemies.length < 50) {
                 const chance = 0.02 + (this.wave * 0.002);
                 if (Math.random() < chance) {
                     this.spawnEnemy(false);
                     this.waveEnemiesSpawned++;
                 }
             }
        }
    }

    spawnEnemy(isBoss: boolean) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 600 + Math.random() * 200; 
        const x = this.player.x + Math.cos(angle) * dist;
        const y = this.player.y + Math.sin(angle) * dist;

        const cont = new Container() as Entity;
        const g = new Graphics();
        
        if (isBoss) {
            const color = 0xef4444; 
            g.rect(-20, -25, 40, 50).fill(color); 
            g.rect(-15, -15, 10, 10).fill(0xffff00); 
            g.rect(5, -15, 10, 10).fill(0xffff00); 
            g.rect(-10, 10, 20, 5).fill(0x000000); 
            g.rect(-25, -5, 5, 20).fill(0x7f1d1d); 
            g.rect(20, -5, 5, 20).fill(0x7f1d1d); 
        } else {
            const type = Math.floor(Math.random() * 3);
            if (type === 0) {
                g.rect(-6, -6, 12, 12).fill(0x10b981);
                g.rect(-4, -4, 2, 2).fill(0x000000); 
                g.rect(2, -4, 2, 2).fill(0x000000); 
                g.rect(-8, -2, 2, 4).fill(0x059669); 
                g.rect(6, -2, 2, 4).fill(0x059669); 
            } else if (type === 1) {
                g.rect(-6, -4, 12, 8).fill(0x06b6d4);
                g.rect(-5, -6, 10, 2).fill(0x06b6d4); 
                g.rect(-2, -2, 2, 2).fill(0xffffff); 
            } else {
                g.rect(-4, -4, 8, 8).fill(0x8b5cf6);
                g.rect(-8, -6, 4, 4).fill(0x6d28d9); 
                g.rect(4, -6, 4, 4).fill(0x6d28d9); 
            }
        }

        cont.addChild(g);
        cont.x = x;
        cont.y = y;
        
        const waveHP = 5 + (this.wave * 1.5);
        cont.maxHp = isBoss ? 300 + (this.wave * 10) : waveHP;
        cont.hp = cont.maxHp;
        cont.radius = isBoss ? 25 : 10;
        cont.isDead = false;
        cont.vx = 0; 
        cont.vy = 0;
        cont.knockbackVx = 0;
        cont.knockbackVy = 0;
        
        cont.isBurning = false;
        cont.isWet = false;
        cont.isElectrified = false;
        cont.burnTimer = 0;
        cont.wetTimer = 0;
        cont.hitFlashTimer = 0;

        this.enemies.push(cont);
        this.world.addChild(cont);
    }

    // --- RECURSIVE LOGIC SYSTEM ---
    weaponCooldowns: { [key: string]: number } = {};

    handleWeapons(delta: number) {
        // Active effects stack
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

            const newEffects: ActiveEffect[] = [];

            if (card.type === CardType.EFFECT && card.effectConfig) {
                // An Effect card "Executes" by adding its effect to the active stack.
                // If executionCount > 1, it adds its effect multiple times.
                
                for(let i=0; i<executionCount; i++) {
                     newEffects.push({
                         logic: card.effectConfig.logic,
                         count: card.effectConfig.influenceCount
                     });
                }
            } 
            else if (card.type === CardType.ARTIFACT && card.artifactConfig) {
                // Handle Cooldown
                if (!this.weaponCooldowns[card.id]) this.weaponCooldowns[card.id] = 0;
                this.weaponCooldowns[card.id] -= delta * buffStats.freqMult;

                // Persistent weapons logic check
                if (card.artifactConfig.projectileType === 'orbit' || (card.id.includes('art_track') && card.artifactConfig.projectileType !== 'beam')) {
                    this.fireArtifact(card, activeEffects, buffStats, 0);
                } 
                else if (this.weaponCooldowns[card.id] <= 0) {
                    // Standard trigger
                    for(let i=0; i<executionCount; i++) {
                         if (i === 0) {
                             this.fireArtifact(card, activeEffects, buffStats, i);
                         } else {
                             // Stagger subsequent triggers more visibly
                             // Use a closure to capture the current state of effects
                             const capturedEffects = [...activeEffects.map(e => ({...e}))]; 
                             this.delayedActions.push({
                                 timer: i * 8, // 8 frames delay per double
                                 action: () => this.fireArtifact(card, capturedEffects, buffStats, i)
                             });
                         }
                    }

                    this.weaponCooldowns[card.id] = card.artifactConfig.cooldown;
                }
            }

            // Aging Logic (Decrement Counts)
            // Fix: Logic modifiers (Double) must decrement on EFFECTS (to prevent infinite multiplication of modifiers).
            // Spatial modifiers (Split, Fan) should ONLY decrement on ARTIFACTS (so they pass through intermediate effects).
            
            const isArtifact = card.type === CardType.ARTIFACT;
            
            activeEffects.forEach(eff => {
                if (eff.logic === 'double') {
                    // Logic modifiers are consumed by everything that isn't a Buff/Stat
                    eff.count--;
                } else if (isArtifact) {
                    // Spatial modifiers are only consumed by Weapons
                    eff.count--;
                }
            });

            activeEffects = activeEffects.filter(eff => eff.count > 0);
            
            // Add new effects for the next iteration
            activeEffects.push(...newEffects);
        }
    }

    fireArtifact(card: CardDef, activeEffects: ActiveEffect[], buffs: any, dupeIndex: number = 0) {
        if (!card.artifactConfig) return;
        const conf = card.artifactConfig;

        // --- Jade Ruyi (Pull) Special Logic ---
        if (card.id.startsWith('art_pull')) {
             // 1. Visual Effect: Full screen rainbow flash
             const flash = new Graphics();
             // Simple rainbow gradient approx using stacked rects with multiply/add
             flash.rect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT).fill({color: 0xff00ff, alpha: 0.1});
             flash.rect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT).fill({color: 0x00ffff, alpha: 0.1});
             flash.rect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT).fill({color: 0xffff00, alpha: 0.1});
             
             // Flash white center
             const cx = SCREEN_WIDTH/2;
             const cy = SCREEN_HEIGHT/2;
             flash.circle(cx, cy, 1000).fill({color: 0xffffff, alpha: 0.2});
             flash.blendMode = 'add';
             
             this.app.stage.addChild(flash);
             
             // Animate Flash fade out
             let alpha = 0.5;
             const fade = (ticker: Ticker) => {
                 alpha -= 0.02;
                 flash.alpha = alpha;
                 if (alpha <= 0) {
                     this.app.ticker.remove(fade);
                     flash.parent?.removeChild(flash);
                     flash.destroy(); // Memory Fix
                 }
             };
             this.app.ticker.add(fade);

             // 2. Logic: Magnetize all XP
             let count = 0;
             this.xpOrbs.forEach(orb => {
                 orb.isMagnetized = true;
                 count++;
             });
             
             if (count > 0) this.spawnText("ABSORB!", this.player.x, this.player.y - 40, 0xff00ff);
             
             return; // Do not spawn a bullet
        }

        // Persistent Weapon Logic: Orbit Sword
        // Fix for Double Cast: We simply check if we have enough instances.
        if (conf.projectileType === 'orbit') {
            const activeInstances = this.bullets.filter(b => b.ownerId === card.id && !b.isDead).length;
            // Allow duplicates logic: If dupeIndex is 1, and we have < 2 swords, spawn one.
            // Simplified: If activeInstances <= dupeIndex, spawn.
            if (activeInstances > dupeIndex) return;
        }

        // Persistent Weapon Logic: Tracking Glaive
        // Fix for Double Cast: Allow multiple glaives
        if (card.id.startsWith('art_track')) {
             const activeInstances = this.bullets.filter(b => b.ownerId === card.id && !b.isDead).length;
             if (activeInstances > dupeIndex) return;
        }

        // Aggregate Logic Modifiers
        let isFan = false;
        let isRing = false;
        let isBack = false;
        let track = false;
        let wobble = false;
        let giant = false;
        
        activeEffects.forEach(m => {
            if (m.logic === 'split_back') isBack = true;
            if (m.logic === 'fan') isFan = true;
            if (m.logic === 'ring') isRing = true;
            if (m.logic === 'track') track = true;
            if (m.logic === 'wobble') wobble = true;
            if (m.logic === 'giant') giant = true;
        });
        
        // Pass Logic flags to buffs object to keep createBullet clean, or just use boolean args
        const flags = { track, wobble, giant };

        // --- Lightning Instant Logic ---
        if (conf.element === ElementType.LIGHTNING) {
            // Find targets
            const range = 250 * buffs.rangeMult;
            let currentSource = { x: this.player.x, y: this.player.y };
            let potentialTargets = this.enemies.filter(e => {
                const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
                return d < range && !e.isDead;
            });
            
            // Sort by distance to player
            potentialTargets.sort((a,b) => Math.hypot(a.x-this.player.x, a.y-this.player.y) - Math.hypot(b.x-this.player.x, b.y-this.player.y));

            // Chain logic
            let chains = 1 + (isFan ? 2 : 0) + (isRing ? 4 : 0);
            if (isBack) chains += 1;
            
            // Limit targets
            const targetsHit: Entity[] = [];
            
            for(let i=0; i<chains; i++) {
                if (potentialTargets.length === 0) break;
                // Pick closest to current source
                let closestIdx = -1;
                let minD = 9999;
                
                for(let j=0; j<potentialTargets.length; j++) {
                     const t = potentialTargets[j];
                     const d = Math.hypot(t.x - currentSource.x, t.y - currentSource.y);
                     if (d < minD) { minD = d; closestIdx = j; }
                }

                if (closestIdx !== -1) {
                    const target = potentialTargets[closestIdx];
                    targetsHit.push(target);
                    // Draw Lightning
                    this.drawLightning(currentSource.x, currentSource.y, target.x, target.y);
                    
                    // Update source for next chain
                    currentSource = { x: target.x, y: target.y };
                    
                    // Remove from potential
                    potentialTargets.splice(closestIdx, 1);
                }
            }
            
            // Deal Damage
            targetsHit.forEach(e => {
                 const dmg = conf.baseDamage * this.stats.damageMultiplier * (giant ? 1.5 : 1);
                 e.hp -= dmg;
                 e.isElectrified = true;
                 this.spawnText(Math.round(dmg).toString(), e.x, e.y - 20, 0xffff00);
                 if (e.hp <= 0) this.killEnemy(e);
            });

            return; // Done, no bullet spawned
        }

        // Aiming Logic for projectiles
        let baseAngle = 0;
        let targetEnemy = null;
        
        if (this.isAutoAim) {
            // Find nearest
            let minD = 99999;
            this.enemies.forEach(e => {
                const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
                if (d < minD) { minD = d; targetEnemy = e; }
            });
            
            if (targetEnemy) {
                baseAngle = Math.atan2(targetEnemy.y - this.player.y, targetEnemy.x - this.player.x);
            } else {
                // No enemy, aim forward (mouse)
                const dx = this.mouse.x - (SCREEN_WIDTH / 2);
                const dy = this.mouse.y - (SCREEN_HEIGHT / 2);
                baseAngle = Math.atan2(dy, dx);
            }
        } else {
            // Manual Aim
            const dx = this.mouse.x - (SCREEN_WIDTH / 2);
            const dy = this.mouse.y - (SCREEN_HEIGHT / 2);
            baseAngle = Math.atan2(dy, dx);
        }

        let projectileCount = 1;
        if (isFan) projectileCount = 5;
        if (isRing) projectileCount = 12;

        const angles: number[] = [];
        
        if (isRing) {
            for(let i=0; i<projectileCount; i++) angles.push(baseAngle + (Math.PI * 2 * i / projectileCount));
        } else if (isFan) {
            for(let i=0; i<projectileCount; i++) angles.push(baseAngle + (i - 2) * 0.3);
        } else {
            angles.push(baseAngle);
        }

        if (isBack) {
            // Fix: Add backshots for ALL existing angles (e.g. Fan + Back = 5 forward, 5 back)
            // Need to copy array first to avoid infinite loop
            const currentAngles = [...angles];
            currentAngles.forEach(a => angles.push(a + Math.PI)); 
        }
        
        angles.forEach(angle => {
            this.createBullet(conf, angle, buffs, flags, card.id, dupeIndex);
        });
    }

    drawLightning(x1: number, y1: number, x2: number, y2: number) {
        const g = new Graphics();
        const dist = Math.hypot(x2-x1, y2-y1);
        const steps = Math.floor(dist / 10);
        
        g.moveTo(x1, y1);
        let currX = x1;
        let currY = y1;
        
        for(let i=1; i<steps; i++) {
            const t = i / steps;
            const targetX = x1 + (x2-x1)*t;
            const targetY = y1 + (y2-y1)*t;
            const jitter = 10;
            const px = targetX + (Math.random()-0.5)*jitter;
            const py = targetY + (Math.random()-0.5)*jitter;
            g.lineTo(px, py);
            currX = px; currY = py;
        }
        g.lineTo(x2, y2);
        
        g.stroke({ width: 3, color: 0xffff00, alpha: 1 });
        g.stroke({ width: 1, color: 0xffffff, alpha: 0.8 });
        
        // Add Glow effect via multiple strokes or blend mode
        // Simple way: Add another wider, lower alpha line
        const glow = new Graphics();
        glow.moveTo(x1, y1);
        glow.lineTo(x2, y2); // Simplified glow path
        glow.stroke({ width: 10, color: 0xffaa00, alpha: 0.3 });
        glow.blendMode = 'add';

        this.world.addChild(glow);
        this.world.addChild(g);
        
        // Fade out
        const fade = (ticker: Ticker) => {
            g.alpha -= 0.1;
            glow.alpha -= 0.1;
            if (g.alpha <= 0) {
                this.app.ticker.remove(fade);
                g.parent?.removeChild(g);
                glow.parent?.removeChild(glow);
                g.destroy(); // Memory Fix
                glow.destroy();
            }
        }
        this.app.ticker.add(fade);
    }

    createBullet(conf: any, angle: number, buffs: any, flags: {track: boolean, wobble: boolean, giant: boolean}, ownerId: string, dupeIndex: number) {
        const b = new Container() as Bullet;
        const g = new Graphics();
        
        let speed = 5 * buffs.speedMult;
        let life = 180 * buffs.rangeMult; 
        let radius = 12;
        let isPersistent = false;
        
        if (flags.giant) {
            b.scale.set(1.5);
        }

        if (conf.element === ElementType.WIND) {
             // Wind Shockwave Visual
             const r = 80 * buffs.rangeMult;
             radius = r;
             
             // Distortion Ring
             g.circle(0,0, r).stroke({ width: 6, color: 0xffffff, alpha: 0.8 });
             g.circle(0,0, r * 0.8).stroke({ width: 2, color: 0xa5f3fc, alpha: 0.4 });
             
             // Particles inside
             for(let i=0; i<5; i++) {
                 g.circle((Math.random()-0.5)*r, (Math.random()-0.5)*r, 2).fill(0xffffff);
             }

             g.blendMode = 'add';
             life = 30; // Short duration
             speed = 0; 
             b.scale.set(0.1); 
        } 
        else if (conf.projectileType === 'stream') {
             // RIVER / STREAM LOGIC
             // Start small, grows rapidly.
             const r = 8;
             radius = r;
             g.circle(0,0, r).fill(conf.color);
             g.circle(0,0, r * 0.7).fill(0xffffff);
             
             speed = 6 * buffs.speedMult;
             life = 40 * buffs.rangeMult;
             
             // Add a tail or distortion
             b.scale.set(0.2); // Start tiny
             
             // Random spread
             angle += (Math.random() - 0.5) * 0.2;
        }
        else if (conf.projectileType === 'orbit') {
            // PIXEL SWORD
            // Blade
            g.rect(-2, -24, 4, 32).fill(0xe2e8f0); // Silver
            // Hilt
            g.rect(-6, 8, 12, 4).fill(0xc084fc); // Purple
            g.rect(-2, 12, 4, 6).fill(0x475569); // Dark handle
            
            // Magic trail
            g.rect(-2, -24, 4, 32).fill({color: 0xffffff, alpha: 0.5});
            
            speed = 0;
            life = 999999;
            isPersistent = true;
            b.orbitAngle = 0 + (dupeIndex * (Math.PI / 2)); // Offset duplicates
            b.rotation = Math.PI / 4; // Point outward initially
        }
        else if (ownerId.startsWith('art_track')) {
            // GLAIVE LOGIC
            // Pole
            g.rect(-1, -15, 2, 30).fill(0x334155); 
            // Blade
            g.bezierCurveTo(0, -15, 8, -25, 0, -35).fill(0x94a3b8);
            g.bezierCurveTo(0, -35, -5, -25, 0, -15).fill(0x94a3b8);
            
            // Side blades
            g.moveTo(0, -18);
            g.lineTo(4, -22);
            g.stroke({width: 1, color: 0xffffff});

            speed = 8;
            life = 999999;
            isPersistent = true;
            b.state = 'IDLE';
            b.orbitAngle = dupeIndex * (Math.PI); // Offset duplicates
        }
        else if (conf.projectileType === 'projectile') {
            g.circle(0,0, 4).fill(0xffffff); 
            g.circle(0,0, 8).fill({ color: conf.color, alpha: 0.6 }); 
            g.blendMode = 'add';
        } else if (conf.projectileType === 'beam') {
            g.rect(0, -5, 40, 10).fill(conf.color);
            g.blendMode = 'add';
            speed = 10 * buffs.speedMult;
        } else if (conf.projectileType === 'area') {
            const r = 100 * buffs.rangeMult;
            radius = r; // Sync Hitbox with Visuals
            g.moveTo(0,0);
            g.arc(0,0, r, -0.5, 0.5); 
            g.lineTo(0,0);
            g.fill({ color: conf.color, alpha: 0.5 });
            g.blendMode = 'add';
            life = 10; 
            speed = 0; 
            if (conf.element === ElementType.FIRE) speed = 3; 
        }
        
        b.addChild(g);
        b.x = this.player.x;
        b.y = this.player.y;
        b.vx = Math.cos(angle) * speed;
        b.vy = Math.sin(angle) * speed;
        b.rotation = angle;
        
        b.damage = conf.baseDamage * this.stats.damageMultiplier * (flags.giant ? 1.5 : 1);
        b.element = conf.element;
        b.duration = life;
        b.radius = radius;
        b.ownerId = ownerId;
        b.isDead = false;
        b.isTracking = flags.track;
        b.isWobble = flags.wobble;
        b.wobblePhase = Math.random() * 10;
        b.hitList = new Set();
        // Persistent weapons have infinite pierce usually, or controlled by logic
        b.pierce = (conf.projectileType === 'area' || isPersistent || conf.element === ElementType.WIND || conf.projectileType === 'stream') ? 999 : 1;
        b.color = conf.color;
        b.trailTimer = 0;

        this.bullets.push(b);
        this.world.addChild(b);
    }

    updateEnemies(delta: number) {
        const playerPos = { x: this.player.x, y: this.player.y };
        
        this.enemies.forEach(e => {
            if (e.isDead) return;

            if (e.hitFlashTimer > 0) {
                e.hitFlashTimer -= delta;
                e.tint = 0xff0000;
            } else {
                e.tint = 0xffffff;
            }

            // Normal Movement
            const dx = playerPos.x - e.x;
            const dy = playerPos.y - e.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            let moveSpeed = (1 + (this.wave * 0.005)) * delta;
            
            // Physics: Knockback Decay
            e.knockbackVx *= 0.9;
            e.knockbackVy *= 0.9;

            // Apply movement + knockback
            if (dist > 10) {
                e.x += (dx / dist) * moveSpeed;
                e.y += (dy / dist) * moveSpeed;
            }
            
            // Apply Knockback velocity
            e.x += e.knockbackVx * delta;
            e.y += e.knockbackVy * delta;

            if (e.isBurning) {
                e.hp -= 0.1 * delta;
                if (Math.random() < 0.1) this.spawnParticle(e.x, e.y, 0xff4500);
            }

            if (e.hp <= 0) this.killEnemy(e);
        });

        this.enemies = this.enemies.filter(e => !e.isDead);
    }

    updateBullets(delta: number) {
        this.bullets.forEach(b => {
            if (b.isDead) return;
            
            // --- Wind Expansion ---
            if (b.element === ElementType.WIND) {
                b.scale.x += 0.05 * delta;
                b.scale.y += 0.05 * delta;
                b.alpha -= 0.03 * delta;
                if (b.alpha <= 0) {
                    b.isDead = true;
                    b.parent?.removeChild(b);
                    b.destroy({ children: true }); // Memory Fix
                }
                b.duration -= delta;
                return; // Custom logic done, skip standard movement
            }

            // --- Stream Expansion (Water) ---
            if (b.element === ElementType.WATER && b.scale.x < 3) {
                 b.scale.x += 0.1 * delta;
                 b.scale.y += 0.1 * delta;
                 b.alpha -= 0.02 * delta;
            }

            b.duration -= delta;
            
            if (b.duration <= 0 || b.alpha <= 0) {
                b.isDead = true;
                b.parent?.removeChild(b);
                b.destroy({ children: true }); // Memory Fix
                return;
            }

            if (b.vx !== 0 || b.vy !== 0) {
                b.trailTimer -= delta;
                if (b.trailTimer <= 0) {
                    // Don't spawn trails for invisible orbiters or large areas
                    if (!b.ownerId.startsWith('art_sword') && !b.ownerId.startsWith('art_track')) {
                       // Lower particle count for stream to save perf
                       if (b.element !== ElementType.WATER || Math.random() > 0.7) {
                          this.spawnParticle(b.x, b.y, b.color, 1);
                       }
                    }
                    b.trailTimer = 3; 
                }
            }

            // --- Persistent Weapons Logic ---
            if (b.ownerId.includes('art_sword_orbit')) { 
                if (b.orbitAngle === undefined) b.orbitAngle = 0;
                b.orbitAngle += 0.05 * delta;
                b.x = this.player.x + Math.cos(b.orbitAngle) * 100;
                b.y = this.player.y + Math.sin(b.orbitAngle) * 100;
                // Rotate sword to point outward
                b.rotation = b.orbitAngle + Math.PI / 2; 
                
                // Clear hitlist periodically so it can hit same enemy again
                if (Math.floor(this.gameTime) % 30 === 0) {
                    b.hitList.clear();
                }
            } 
            else if (b.ownerId.startsWith('art_track')) {
                // GLAIVE LOGIC
                // State Machine: IDLE (orbit) -> SEEK (found target) -> RETURN (too far)
                if (!b.state) b.state = 'IDLE';

                if (b.state === 'IDLE') {
                    // Orbit slowly near player
                    if (b.orbitAngle === undefined) b.orbitAngle = 0;
                    b.orbitAngle -= 0.02 * delta;
                    const targetX = this.player.x + Math.cos(b.orbitAngle) * 60;
                    const targetY = this.player.y + Math.sin(b.orbitAngle) * 60;
                    
                    // Smooth move
                    b.x += (targetX - b.x) * 0.1 * delta;
                    b.y += (targetY - b.y) * 0.1 * delta;
                    b.rotation += 0.1 * delta;

                    // Look for target
                    let closest = null;
                    let minD = 400; // Search range
                    for(const e of this.enemies) {
                        const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
                        if(d < minD) { minD = d; closest = e; }
                    }
                    if (closest) {
                        b.state = 'SEEK';
                        b.target = closest;
                    }
                }
                else if (b.state === 'SEEK') {
                    if (!b.target || b.target.isDead) {
                        b.state = 'IDLE';
                        b.target = null;
                    } else {
                        const angle = Math.atan2(b.target.y - b.y, b.target.x - b.x);
                        b.vx = Math.cos(angle) * 12; // Fast
                        b.vy = Math.sin(angle) * 12;
                        b.x += b.vx * delta;
                        b.y += b.vy * delta;
                        b.rotation += 0.5 * delta; // Spin fast

                        const dToPlayer = Math.hypot(b.x - this.player.x, b.y - this.player.y);
                        if (dToPlayer > 500) {
                            b.state = 'IDLE'; // Leash
                        }
                    }
                }
                
                // Reset Hitlist for continuous damage
                if (Math.floor(this.gameTime) % 20 === 0) {
                    b.hitList.clear();
                }
            }
            // --- Standard Tracking ---
            else if (b.isTracking) {
                let nearest = null;
                let minDst = 1000;
                for (const e of this.enemies) {
                    const d = Math.hypot(e.x - b.x, e.y - b.y);
                    if (d < minDst) { minDst = d; nearest = e; }
                }
                if (nearest) {
                    const angle = Math.atan2(nearest.y - b.y, nearest.x - b.x);
                    b.vx = b.vx * 0.9 + Math.cos(angle) * 1;
                    b.vy = b.vy * 0.9 + Math.sin(angle) * 1;
                }
                b.x += b.vx * delta;
                b.y += b.vy * delta;
            } else {
                // --- Wobble Logic ---
                if (b.isWobble) {
                    if (b.wobblePhase === undefined) b.wobblePhase = 0;
                    b.wobblePhase += 0.2 * delta;
                    
                    // Calculate Perpendicular Vector
                    const len = Math.hypot(b.vx, b.vy);
                    if (len > 0) {
                        const px = -b.vy / len;
                        const py = b.vx / len;
                        const offset = Math.sin(b.wobblePhase) * 2 * delta;
                        
                        b.x += b.vx * delta + px * offset;
                        b.y += b.vy * delta + py * offset;
                        return; // Handled move
                    }
                }

                b.x += b.vx * delta;
                b.y += b.vy * delta;
            }
        });
        this.bullets = this.bullets.filter(b => !b.isDead);
    }

    updateParticles(delta: number) {
        this.particles.forEach(p => {
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
                p.destroy(); // Memory Fix
            }
        });
        this.particles = this.particles.filter(p => p.life > 0 && p.alpha > 0);
    }

    updateXP(delta: number) {
        this.xpOrbs.forEach(orb => {
            const dx = this.player.x - orb.x;
            const dy = this.player.y - orb.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Magnetized logic (Jade Ruyi) or normal range
            if (orb.isMagnetized || dist < this.stats.pickupRange) {
                // If magnetized, infinite range and faster speed
                const speed = orb.isMagnetized ? 15 : 8;
                
                orb.x += (dx/dist) * speed * delta;
                orb.y += (dy/dist) * speed * delta;
                
                if (dist < 10) {
                    this.stats.xp += orb.value;
                    orb.parent?.removeChild(orb);
                    orb.destroy(); // Memory Fix
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
                 const dx = this.player.x - e.x;
                 const dy = this.player.y - e.y;
                 const dist = Math.sqrt(dx * dx + dy * dy);
                 if (dist < (this.player.radius + e.radius)) {
                     this.player.hp -= 5 + (this.wave * 0.5); 
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
            if (b.isDead) continue;
            
            // Optimization: Grid check or simple AABB before Circle? Circle is fast enough for < 100 enemies.
            for (const e of this.enemies) {
                if (e.isDead) continue;
                if (b.hitList.has(this.getObjectId(e))) continue;

                // For wind, checking collision is slightly different (radius based, visual scale matches hitbox)
                // b.radius is updated in create, but wind scales.
                let hitRadius = b.radius;
                if (b.element === ElementType.WIND || b.element === ElementType.WATER) hitRadius *= b.scale.x; 

                const dx = b.x - e.x;
                const dy = b.y - e.y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < (hitRadius + e.radius)) {
                    this.applyDamage(e, b);
                    b.hitList.add(this.getObjectId(e));
                    
                    b.pierce--;
                    if (b.pierce <= 0) {
                        b.isDead = true;
                        b.parent?.removeChild(b);
                        b.destroy({ children: true }); // Memory Fix
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
            // Physics Knockback instead of Teleport
            const angle = Math.atan2(e.y - b.y, e.x - b.x);
            // Strong push
            e.knockbackVx += Math.cos(angle) * 10;
            e.knockbackVy += Math.sin(angle) * 10;
        }

        if (b.element === ElementType.FIRE) {
            e.isBurning = true;
            if (e.isWet) { 
                e.isBurning = false; 
                this.spawnText("Extinguish", e.x, e.y, 0xaaaaff);
            }
        }

        if (b.element === ElementType.WATER) {
            e.isWet = true;
            const angle = Math.atan2(e.y - b.y, e.x - b.x);
            // Medium push
            e.knockbackVx += Math.cos(angle) * 5; 
            e.knockbackVy += Math.sin(angle) * 5;
            
            if (e.isBurning) {
                e.isBurning = false; 
                dmg *= 0.5; 
            }
        }

        // Standard Lightning (not the instant one) - Keep for backward compatibility or other mods
        if (b.element === ElementType.LIGHTNING) {
            if (e.isWet) {
                this.triggerChainLightning(e, dmg);
                this.spawnText("CHAIN!", e.x, e.y, 0xffff00);
            }
            if (e.isBurning) {
                dmg *= 2; 
                e.isBurning = false;
                this.spawnText("EXPLODE!", e.x, e.y, 0xffaa00);
                this.spawnParticle(e.x, e.y, 0xffaa00, 10);
            }
        }

        if (dmg > 0) {
            e.hp -= dmg;
            e.hitFlashTimer = 5; 
            
            this.damageTextCooldown--;
            if (this.damageTextCooldown <= 0 || dmg > 10) { 
                this.spawnText(Math.round(dmg).toString(), e.x, e.y - 20, 0xffffff);
                this.damageTextCooldown = 2; 
            }
        }

        this.spawnParticle(e.x, e.y, b.color, 3);
    }

    triggerChainLightning(source: Entity, dmg: number) {
        if (this.enemies.length > 200) return; 

        this.enemies.forEach(target => {
            if (target === source) return;
            const d = Math.hypot(target.x - source.x, target.y - source.y);
            if (d < 100) {
                target.hp -= dmg * 0.5;
                const g = new Graphics();
                g.moveTo(source.x, source.y);
                g.lineTo(target.x, target.y);
                g.stroke({ width: 2, color: 0xffff00 }); 
                this.world.addChild(g);
                setTimeout(() => {
                    g.parent?.removeChild(g);
                    g.destroy(); // Memory fix
                }, 100);
            }
        });
    }

    killEnemy(e: Entity) {
        e.isDead = true;
        this.world.removeChild(e);
        e.destroy({ children: true }); // Memory Fix
        
        const orb = new Graphics() as XPOrb;
        let color = 0x888888;
        let size = 6;
        const val = 1 + (this.wave * 0.5);
        
        if (this.wave > 10) { color = 0x00ff00; size = 8; }
        if (this.wave > 30) { color = 0x00ffff; size = 10; } 
        if (this.wave > 80) { color = 0xffd700; size = 12; } 

        orb.poly([
            0, -size,
            size, 0,
            0, size,
            -size, 0
        ]).fill(color);

        orb.x = e.x;
        orb.y = e.y;
        orb.value = val;
        
        this.xpOrbs.push(orb);
        this.world.addChild(orb);

        if (this.wave === 100 && e.maxHp > 10000) { 
            this.state = GameState.VICTORY;
            this.onGameStateChange(GameState.VICTORY);
        }
    }

    startLevelUpSequence() {
        this.state = GameState.PRE_LEVEL_UP;
        this.preLevelUpTimer = 90; 
        this.onGameStateChange(GameState.PRE_LEVEL_UP);
        this.spawnText("LEVEL UP!", this.player.x, this.player.y - 50, 0xffd700);
    }

    triggerLevelUpUI() {
        this.state = GameState.LEVEL_UP;
        this.onGameStateChange(GameState.LEVEL_UP);
        this.stats.level++;
        this.stats.xp = 0;
        this.stats.nextLevelXp = Math.floor(this.stats.nextLevelXp * 1.5);
    }

    spawnText(text: string, x: number, y: number, color: number) {
        if (this.app.ticker.FPS < 40 && Math.random() > 0.5) return;

        const t = new Text({
            text: text,
            style: {
                fontFamily: 'Courier New', // Faster font
                fontSize: 14,
                fill: color,
                stroke: { color: 0x000000, width: 2 },
                align: 'center',
                fontWeight: 'bold'
            }
        });
        t.x = x;
        t.y = y;
        this.world.addChild(t);
        let tick = 0;
        const anim = (ticker: Ticker) => {
            tick++;
            t.y -= 1;
            t.alpha -= 0.02;
            if (tick > 50) {
                this.app.ticker.remove(anim);
                t.parent?.removeChild(t);
                t.destroy(); // Memory fix
            }
        };
        this.app.ticker.add(anim);
    }

    spawnParticle(x: number, y: number, color: number, count = 3, upward = false) {
        if (this.app.ticker.FPS < 30) return; 

        for(let i=0; i<count; i++) {
            const p = new Graphics() as Particle;
            p.circle(0,0, 3).fill(color);
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
            p.blendMode = 'add'; 
            
            this.particles.push(p);
            this.world.addChild(p);
        }
    }

    addCard(card: CardDef) {
        if (card.type === CardType.STAT && card.statBonus) {
            if (card.statBonus.hpPercent) {
                const increase = this.stats.maxHp * card.statBonus.hpPercent;
                this.stats.maxHp += increase;
                // Correctly update Entity Stats
                this.player.maxHp = this.stats.maxHp;
                this.player.hp += increase; // Heal for the amount gained
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

    destroy() {
        try {
            this.app.destroy({ removeView: true } as any);
        } catch(e) { console.error(e) }
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mousedown', this.handleMouseDown);
    }
}