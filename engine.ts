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
    state?: string; // 'IDLE', 'SEEK', 'RETURN', 'ATTACK'
    target?: Entity | null;
    orbitAngle?: number;
    attackTimer?: number; // For minion attack cooldown
    
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
            resolution: Math.min(window.devicePixelRatio, 2), // Limit resolution for perf
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

        // Cleanup any existing entities from previous session
        this.enemies.forEach(e => { e.destroy({children:true}); });
        this.enemies = [];
        this.bullets.forEach(b => { b.destroy({children:true}); });
        this.bullets = [];
        this.xpOrbs.forEach(x => { x.destroy(); });
        this.xpOrbs = [];
        this.obstacles.forEach(o => o.destroy());
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

        if (this.player.moveTarget) {
            const dx = this.player.moveTarget.x - this.player.x;
            const dy = this.player.moveTarget.y - this.player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 5) {
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
            } else if (type === 1) {
                g.rect(-6, -4, 12, 8).fill(0x06b6d4);
                g.rect(-5, -6, 10, 2).fill(0x06b6d4); 
            } else {
                g.rect(-4, -4, 8, 8).fill(0x8b5cf6);
                g.rect(-8, -6, 4, 4).fill(0x6d28d9); 
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
        if (card.id.startsWith('art_pull')) {
             const flash = new Graphics();
             flash.rect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT).fill({color: 0xff00ff, alpha: 0.1});
             flash.blendMode = 'add';
             this.world.addChild(flash);
             
             this.tempEffects.push({
                 container: flash,
                 life: 50,
                 onUpdate: (g, life) => { g.alpha = (life/50) * 0.3; }
             });

             let count = 0;
             this.xpOrbs.forEach(orb => {
                 orb.isMagnetized = true;
                 count++;
             });
             if (count > 0) this.spawnText("ABSORB!", this.player.x, this.player.y - 40, 0xff00ff);
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
        let giant = false;
        
        activeEffects.forEach(m => {
            if (m.logic === 'split_back') isBack = true;
            if (m.logic === 'fan') isFan = true;
            if (m.logic === 'ring') isRing = true;
            if (m.logic === 'track') track = true;
            if (m.logic === 'wobble') wobble = true;
            if (m.logic === 'giant') giant = true;
        });
        
        const flags = { track, wobble, giant };

        // --- Lightning Instant Logic ---
        if (conf.element === ElementType.LIGHTNING) {
            const range = 350 * buffs.rangeMult;
            let currentSource = { x: this.player.x, y: this.player.y };
            let potentialTargets = this.enemies.filter(e => {
                const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
                // CRITICAL FIX: Ensure !e.destroyed
                return d < range && !e.isDead && !e.destroyed;
            });
            potentialTargets.sort((a,b) => Math.hypot(a.x-this.player.x, a.y-this.player.y) - Math.hypot(b.x-this.player.x, b.y-this.player.y));

            let chains = 2 + (isFan ? 2 : 0) + (isRing ? 4 : 0);
            if (isBack) chains += 1;
            
            const targetsHit: Entity[] = [];
            
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
                    targetsHit.push(target);
                    this.drawLightning(currentSource.x, currentSource.y, target.x, target.y);
                    currentSource = { x: target.x, y: target.y };
                    potentialTargets.splice(closestIdx, 1);
                }
            }
            targetsHit.forEach(e => {
                 const dmg = conf.baseDamage * this.stats.damageMultiplier * (giant ? 1.5 : 1);
                 e.hp -= dmg;
                 e.isElectrified = true;
                 this.spawnText(Math.round(dmg).toString(), e.x, e.y - 20, 0xffff00);
                 if (e.hp <= 0) this.killEnemy(e);
            });
            return; 
        }

        // Projectile Angles
        let baseAngle = 0;
        let targetEnemy = null;
        
        if (this.isAutoAim) {
            let minD = 99999;
            this.enemies.forEach(e => {
                // Safety
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

        // Fire Gourd Special: Fan Area
        if (card.id.startsWith('art_fire')) {
             isFan = true; // Force fan
        }

        let projectileCount = 1;
        if (isFan) projectileCount = 5;
        if (isRing) projectileCount = 12;

        const angles: number[] = [];
        
        if (isRing) {
            for(let i=0; i<projectileCount; i++) angles.push(baseAngle + (Math.PI * 2 * i / projectileCount));
        } else if (isFan) {
            for(let i=0; i<projectileCount; i++) angles.push(baseAngle + (i - 2) * 0.2);
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

    drawLightning(x1: number, y1: number, x2: number, y2: number) {
        const g = new Graphics();
        const dist = Math.hypot(x2-x1, y2-y1);
        const steps = Math.max(2, Math.floor(dist / 20));
        
        g.moveTo(x1, y1);
        
        for(let i=1; i<steps; i++) {
            const t = i / steps;
            const targetX = x1 + (x2-x1)*t;
            const targetY = y1 + (y2-y1)*t;
            const jitter = 15;
            const px = targetX + (Math.random()-0.5)*jitter;
            const py = targetY + (Math.random()-0.5)*jitter;
            g.lineTo(px, py);
        }
        g.lineTo(x2, y2);
        g.stroke({ width: 3, color: 0xffff00, alpha: 1 });

        this.world.addChild(g);
        
        this.tempEffects.push({
            container: g,
            life: 8,
            onUpdate: (gfx, life) => { gfx.alpha = life/8; }
        });
    }

    createBullet(conf: any, angle: number, buffs: any, flags: {track: boolean, wobble: boolean, giant: boolean}, ownerId: string, dupeIndex: number) {
        const b = new Container() as Bullet;
        const g = new Graphics();
        
        let speed = 5 * buffs.speedMult;
        let life = 180 * buffs.rangeMult; 
        let radius = 12;
        let isPersistent = false;
        
        if (flags.giant) b.scale.set(1.5);

        if (conf.element === ElementType.WIND) {
             const r = 80 * buffs.rangeMult;
             radius = r;
             // Improved Shockwave
             g.circle(0,0, r).stroke({ width: 4, color: 0xffffff, alpha: 0.8 });
             g.circle(0,0, r * 0.7).stroke({ width: 2, color: 0xa5f3fc, alpha: 0.6 });
             life = 30; 
             speed = 2; // Moves slightly
             b.scale.set(0.1); 
        } 
        else if (conf.projectileType === 'stream') {
             // Water Stream
             const r = 10;
             radius = r;
             g.rect(0, -r, 40, r*2).fill(conf.color); // Long stream segment
             g.circle(0, 0, r).fill(0xffffff); // Head
             speed = 7 * buffs.speedMult;
             life = 50 * buffs.rangeMult;
             b.scale.set(0.3); 
             angle += (Math.random() - 0.5) * 0.1; // Spray
        }
        else if (conf.projectileType === 'orbit') {
            // Sword Orbit
            g.rect(-2, -24, 4, 32).fill(0xe2e8f0); 
            g.rect(-6, 8, 12, 4).fill(0xc084fc); 
            g.rect(-2, 12, 4, 6).fill(0x475569); 
            speed = 0;
            life = 999999;
            isPersistent = true;
            b.orbitAngle = 0 + (dupeIndex * (Math.PI / 2)); 
            b.rotation = Math.PI / 4; 
        }
        else if (conf.projectileType === 'minion') {
            // --- San Jian Liang Ren Dao ---
            // Huge Polearm
            // Handle
            g.rect(-2, -20, 4, 60).fill(0x52525b); // Dark gray
            g.rect(-3, 30, 6, 5).fill(0xd4d4d8); // Pommel
            // Blade Base
            g.moveTo(0, -20);
            g.lineTo(-10, -30);
            g.lineTo(10, -30);
            g.fill(0xffd700); // Gold guard
            // Blades
            g.beginPath();
            g.moveTo(0, -30);
            g.lineTo(-4, -80); // Center tip
            g.lineTo(4, -80); 
            g.fill(0xe2e8f0); // Silver
            // Side blades
            g.moveTo(-8, -30);
            g.quadraticCurveTo(-20, -40, -12, -60);
            g.lineTo(-8, -30);
            g.fill(0xe2e8f0);
            
            g.moveTo(8, -30);
            g.quadraticCurveTo(20, -40, 12, -60);
            g.lineTo(8, -30);
            g.fill(0xe2e8f0);

            speed = 0;
            life = 999999;
            isPersistent = true;
            b.state = 'IDLE';
            b.orbitAngle = dupeIndex * (Math.PI); 
            b.attackTimer = 0;
            b.scale.set(1.2);
        }
        else if (conf.projectileType === 'projectile') {
            g.circle(0,0, 5).fill(0xffffff); 
            g.circle(0,0, 8).fill({ color: conf.color, alpha: 0.6 }); 
            g.blendMode = 'add';
        } else if (conf.projectileType === 'area') {
            // Fire Breath
            const r = 100 * buffs.rangeMult;
            radius = r; 
            g.moveTo(0,0);
            g.arc(0,0, r, -0.4, 0.4); 
            g.lineTo(0,0);
            g.fill({ color: conf.color, alpha: 0.4 });
            life = 15; 
            speed = 0; 
            b.scale.set(0.5); // Start small expand
        }
        
        b.addChild(g);
        b.x = this.player.x;
        b.y = this.player.y;
        b.vx = Math.cos(angle) * speed;
        b.vy = Math.sin(angle) * speed;
        b.rotation = angle + Math.PI/2; // Orient graphics correctly
        if (conf.projectileType === 'projectile' || conf.projectileType === 'stream') b.rotation = angle;
        if (conf.projectileType === 'area') b.rotation = angle;
        if (conf.element === ElementType.WIND) b.rotation = 0;

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
        b.pierce = (conf.projectileType === 'area' || isPersistent || conf.element === ElementType.WIND || conf.projectileType === 'stream') ? 999 : 1;
        b.color = conf.color;
        b.trailTimer = 0;

        this.bullets.push(b);
        this.world.addChild(b);
    }

    updateEnemies(delta: number) {
        const playerPos = { x: this.player.x, y: this.player.y };
        
        this.enemies.forEach(e => {
            // CRITICAL FIX: Check destroyed or dead
            if (e.isDead || e.destroyed) return;

            if (e.hitFlashTimer > 0) {
                e.hitFlashTimer -= delta;
                e.tint = 0xff0000;
            } else {
                e.tint = 0xffffff;
            }

            const dx = playerPos.x - e.x;
            const dy = playerPos.y - e.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            let moveSpeed = (1 + (this.wave * 0.005)) * delta;
            
            e.knockbackVx *= 0.85; // Faster decay
            e.knockbackVy *= 0.85;

            if (dist > 10) {
                // Soft collision with other enemies to prevent stacking
                let pushX = 0, pushY = 0;
                // Optimization: Only check a few random neighbors or use grid? 
                // For < 50 enemies simple iteration is ok
                if (this.enemies.length < 50) {
                    this.enemies.forEach(other => {
                        if (e === other || other.isDead || other.destroyed) return;
                        const idx = e.x - other.x;
                        const idy = e.y - other.y;
                        const idist = Math.sqrt(idx*idx + idy*idy);
                        if (idist < (e.radius + other.radius)) {
                            pushX += idx / idist;
                            pushY += idy / idist;
                        }
                    });
                }
                
                e.x += (dx / dist) * moveSpeed + pushX * 0.5;
                e.y += (dy / dist) * moveSpeed + pushY * 0.5;
            }
            
            e.x += e.knockbackVx * delta;
            e.y += e.knockbackVy * delta;

            if (e.isBurning) {
                e.hp -= 0.1 * delta;
                if (Math.random() < 0.1) this.spawnParticle(e.x, e.y, 0xff4500);
            }

            if (e.hp <= 0) this.killEnemy(e);
        });

        this.enemies = this.enemies.filter(e => !e.isDead && !e.destroyed);
    }

    updateBullets(delta: number) {
        this.bullets.forEach(b => {
            if (b.isDead || b.destroyed) return;
            
            // --- Visual Expansions ---
            if (b.element === ElementType.WIND) {
                b.scale.x += 0.05 * delta;
                b.scale.y += 0.05 * delta;
                b.alpha -= 0.03 * delta;
                if (b.alpha <= 0) this.killBullet(b);
                b.duration -= delta;
                return; 
            }
            if (b.element === ElementType.FIRE && b.radius > 50) {
                 b.scale.x += 0.05 * delta;
                 b.scale.y += 0.05 * delta;
                 b.alpha -= 0.05 * delta;
            }
            if (b.element === ElementType.WATER && b.scale.x < 3) {
                 b.scale.x += 0.1 * delta;
                 b.scale.y += 0.1 * delta;
                 b.alpha -= 0.02 * delta;
            }

            b.duration -= delta;
            if (b.duration <= 0 || b.alpha <= 0) {
                this.killBullet(b);
                return;
            }

            // --- Trails ---
            if (b.vx !== 0 || b.vy !== 0) {
                b.trailTimer -= delta;
                if (b.trailTimer <= 0) {
                    if (!b.ownerId.startsWith('art_sword') && !b.ownerId.startsWith('art_track')) {
                       if (b.element !== ElementType.WATER || Math.random() > 0.7) {
                          // Simple trail
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

            // --- Minion Logic (San Jian Liang Ren Dao) ---
            if (b.ownerId.startsWith('art_track')) {
                // Minion Behavior
                if (!b.state) b.state = 'IDLE';
                if (!b.attackTimer) b.attackTimer = 0;

                if (b.state === 'IDLE') {
                    // Hover near player
                    if (b.orbitAngle === undefined) b.orbitAngle = 0;
                    b.orbitAngle += 0.02 * delta; // Slow orbit
                    const targetX = this.player.x + Math.cos(b.orbitAngle) * 50;
                    const targetY = this.player.y + Math.sin(b.orbitAngle) * 50 - 30;
                    
                    b.x += (targetX - b.x) * 0.1 * delta;
                    b.y += (targetY - b.y) * 0.1 * delta;
                    b.rotation = 0; // Upright

                    if (b.attackTimer > 0) b.attackTimer -= delta;
                    else {
                        // Find Target
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
                     // CRITICAL FIX: Ensure target is valid before access
                     if (!b.target || b.target.isDead || b.target.destroyed) {
                         b.state = 'IDLE';
                         b.target = null;
                         return;
                     }
                     const dx = b.target.x - b.x;
                     const dy = b.target.y - b.y;
                     const dist = Math.hypot(dx, dy);
                     
                     if (dist > 20) {
                         b.x += (dx/dist) * 15 * delta; // Dash
                         b.y += (dy/dist) * 15 * delta;
                         b.rotation = Math.atan2(dy, dx) + Math.PI/2;
                     } else {
                         // Hit
                         b.state = 'SLASH';
                         b.attackTimer = 15; // Slash duration
                     }
                }
                else if (b.state === 'SLASH') {
                    b.rotation += 0.5 * delta; // Spin slash
                    b.attackTimer! -= delta;
                    // AoE Damage
                    this.enemies.forEach(e => {
                        if (e.isDead || e.destroyed) return;
                        const d = Math.hypot(e.x - b.x, e.y - b.y);
                        if (d < 50) {
                            this.applyDamage(e, b); // Will throttle damage via hitList logic usually, but here we want pure DPS
                        }
                    });

                    if (b.attackTimer! <= 0) {
                        b.state = 'IDLE';
                        b.attackTimer = 20; // Cooldown before next target
                    }
                }

                // Reset hitlist occasionally so slash can hit multiple times
                if (Math.floor(this.gameTime) % 10 === 0) b.hitList.clear();
            }
            // --- Orbit Sword ---
            else if (b.ownerId.includes('art_sword_orbit')) { 
                if (b.orbitAngle === undefined) b.orbitAngle = 0;
                b.orbitAngle += 0.05 * delta;
                b.x = this.player.x + Math.cos(b.orbitAngle) * 100;
                b.y = this.player.y + Math.sin(b.orbitAngle) * 100;
                b.rotation = b.orbitAngle + Math.PI / 2; 
                
                if (Math.floor(this.gameTime) % 30 === 0) b.hitList.clear();
            } 
            // --- Standard Projectiles ---
            else if (b.isTracking) {
                let nearest = null;
                let minDst = 1000;
                for (const e of this.enemies) {
                    if (e.isDead || e.destroyed) continue;
                    const d = Math.hypot(e.x - b.x, e.y - b.y);
                    if (d < minDst) { minDst = d; nearest = e; }
                }
                if (nearest) {
                    const angle = Math.atan2(nearest.y - b.y, nearest.x - b.x);
                    // Homing strength
                    b.vx = b.vx * 0.9 + Math.cos(angle) * 2;
                    b.vy = b.vy * 0.9 + Math.sin(angle) * 2;
                }
                b.x += b.vx * delta;
                b.y += b.vy * delta;
            } else {
                if (b.isWobble) {
                    if (b.wobblePhase === undefined) b.wobblePhase = 0;
                    b.wobblePhase += 0.2 * delta;
                    const len = Math.hypot(b.vx, b.vy);
                    if (len > 0) {
                        const px = -b.vy / len;
                        const py = b.vx / len;
                        const offset = Math.sin(b.wobblePhase) * 2 * delta;
                        b.x += b.vx * delta + px * offset;
                        b.y += b.vy * delta + py * offset;
                        return; 
                    }
                }
                b.x += b.vx * delta;
                b.y += b.vy * delta;
            }
        });
        this.bullets = this.bullets.filter(b => !b.isDead && !b.destroyed);
    }

    killBullet(b: Bullet) {
        b.isDead = true;
        b.parent?.removeChild(b);
        b.destroy({ children: true });
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
                const speed = orb.isMagnetized ? 15 : 8;
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
            if (b.isDead || b.destroyed) continue;
            
            for (const e of this.enemies) {
                if (e.isDead || e.destroyed) continue;
                if (b.hitList.has(this.getObjectId(e))) continue;

                let hitRadius = b.radius;
                if (b.element === ElementType.WIND || b.element === ElementType.WATER) hitRadius *= b.scale.x; 
                // Minion hit logic handled inside minion update, but collision safety check:
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
            e.knockbackVx += Math.cos(angle) * 15;
            e.knockbackVy += Math.sin(angle) * 15;
        }

        if (b.element === ElementType.FIRE) {
            e.isBurning = true;
            if (e.isWet) { e.isBurning = false; }
        }

        if (b.element === ElementType.WATER) {
            e.isWet = true;
            const angle = Math.atan2(e.y - b.y, e.x - b.x);
            e.knockbackVx += Math.cos(angle) * 5; 
            e.knockbackVy += Math.sin(angle) * 5;
            if (e.isBurning) { e.isBurning = false; dmg *= 0.5; }
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

        if (Math.random() > 0.5) this.spawnParticle(e.x, e.y, b.color, 2);
        
        // Ensure kill logic
        if (e.hp <= 0 && !e.isDead) this.killEnemy(e);
    }

    killEnemy(e: Entity) {
        if (e.isDead || e.destroyed) return;
        e.isDead = true;
        this.world.removeChild(e);
        e.destroy({ children: true }); 
        
        const orb = new Graphics() as XPOrb;
        let color = 0x888888;
        let size = 6;
        const val = 1 + (this.wave * 0.5);
        
        if (this.wave > 10) { color = 0x00ff00; size = 8; }
        
        orb.poly([0, -size, size, 0, 0, size, -size, 0]).fill(color);
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
        if (this.floatingTexts.length > 50) return; // Hard limit

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
            p.rect(0,0, 3, 3).fill(color); // Rects are faster than circles
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
        this.waveTotalEnemies = Math.floor(10 + this.wave * 2.5);
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