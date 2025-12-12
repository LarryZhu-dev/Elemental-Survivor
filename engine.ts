import { Application, Container, Graphics, Text, Ticker } from 'pixi.js';
import { CardDef, CardType, ElementType, EnemyDef, GameState, MapType, PlayerStats, Rarity } from './types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './constants';

// --- internal types ---
type Entity = Container & {
    vx: number;
    vy: number;
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
    target?: Entity;
    pierce: number;
    hitList: Set<number>; // Enemy IDs hit
}

type Particle = Graphics & {
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
}

type XPOrb = Graphics & {
    value: number;
    vx: number;
    vy: number;
}

export class GameEngine {
    app: Application;
    canvas: HTMLCanvasElement;
    state: GameState = GameState.MENU;
    
    // Containers
    world: Container;
    playerContainer: Container;
    
    // Entities
    player: Entity;
    enemies: Entity[] = [];
    bullets: Bullet[] = [];
    particles: Particle[] = [];
    xpOrbs: XPOrb[] = [];
    obstacles: Graphics[] = []; // Simple rects

    // Game Logic
    stats: PlayerStats;
    wave: number = 1;
    waveTimer: number = 0;
    gameTime: number = 0;
    
    // Input
    keys: { [key: string]: boolean } = {};
    mouse: { x: number, y: number } = { x: 0, y: 0 };
    isMoveMode: boolean = false; // 'F' toggles this

    // Callbacks to React
    onUpdateStats: (stats: PlayerStats) => void;
    onGameStateChange: (state: GameState) => void;
    onBossWarning: (name: string) => void;

    // Config
    mapType: MapType = MapType.FIXED;
    
    constructor(
        canvas: HTMLCanvasElement, 
        onUpdateStats: (s: PlayerStats) => void,
        onGameStateChange: (s: GameState) => void,
        onBossWarning: (n: string) => void
    ) {
        this.canvas = canvas;
        this.app = new Application();

        this.onUpdateStats = onUpdateStats;
        this.onGameStateChange = onGameStateChange;
        this.onBossWarning = onBossWarning;

        // Init Stats
        this.stats = {
            hp: 100,
            maxHp: 100,
            level: 1,
            xp: 0,
            nextLevelXp: 10,
            speed: 4,
            damageMultiplier: 1,
            pickupRange: 100,
            inventory: []
        };

        // Add initial weapon
        this.addInitialWeapon();
        
        // Placeholders to satisfy TS, real init in init()
        this.world = new Container(); 
        this.player = new Container() as Entity; 
        this.playerContainer = this.player;
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
        this.playerContainer = this.player; // Alias

        // Bind Inputs
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mousedown', this.handleMouseDown);

        // Start Loop
        this.app.ticker.add(this.update.bind(this));
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
                cooldown: 60,
                baseDamage: 2, // 2 hits to kill wave 1 enemy (2hp)
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
        g.beginFill(0xffffff);
        g.drawRect(-8, -8, 16, 16); // Pixel body
        g.endFill();
        g.beginFill(0x4444ff); // Cape
        g.drawRect(-6, -6, 12, 12);
        g.endFill();

        cont.addChild(g);
        cont.x = SCREEN_WIDTH / 2;
        cont.y = SCREEN_HEIGHT / 2;
        cont.vx = 0;
        cont.vy = 0;
        cont.hp = 100;
        cont.maxHp = 100;
        cont.radius = 10;
        cont.isDead = false;
        cont.zIndex = 100;
        return cont;
    }

    start(mapType: MapType) {
        this.mapType = mapType;
        this.state = GameState.PLAYING;
        this.generateMap();
        this.onGameStateChange(GameState.PLAYING);
    }

    generateMap() {
        // Generate random obstacles
        for (let i = 0; i < 50; i++) {
            const obs = new Graphics();
            const type = Math.random();
            if (type < 0.3) {
                // Tree
                obs.beginFill(0x228b22);
                obs.drawCircle(0, 0, 20 + Math.random() * 20);
            } else if (type < 0.6) {
                // Rock
                obs.beginFill(0x555555);
                obs.drawRect(-15, -15, 30, 30);
            } else {
                // Wall
                obs.beginFill(0x8b4513);
                obs.drawRect(-10, -30, 20, 60);
            }
            obs.endFill();
            
            // Random pos relative to center
            const range = this.mapType === MapType.FIXED ? 1000 : 3000;
            obs.x = (Math.random() - 0.5) * 2 * range + SCREEN_WIDTH/2;
            obs.y = (Math.random() - 0.5) * 2 * range + SCREEN_HEIGHT/2;
            
            this.obstacles.push(obs);
            this.world.addChild(obs);
        }
    }

    handleKeyDown = (e: KeyboardEvent) => {
        this.keys[e.key.toLowerCase()] = true;
        if (e.code === 'KeyF') {
            this.isMoveMode = true;
        }
        if (e.code === 'KeyS') {
            this.isMoveMode = false;
            this.player.vx = 0;
            this.player.vy = 0;
        }
        if (e.code === 'Escape') {
            if (this.state === GameState.PLAYING) {
                this.state = GameState.PAUSED;
                this.onGameStateChange(GameState.PAUSED);
            } else if (this.state === GameState.PAUSED) {
                this.state = GameState.PLAYING;
                this.onGameStateChange(GameState.PLAYING);
            }
        }
    }

    handleKeyUp = (e: KeyboardEvent) => {
        this.keys[e.key.toLowerCase()] = false;
    }

    handleMouseMove = (e: MouseEvent) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
    }

    handleMouseDown = () => {
        // Manual fire maybe? For now auto-fire.
    }

    update(ticker: Ticker) {
        if (this.state !== GameState.PLAYING) return;
        
        // Ticker provides delta, use it. Usually it's close to 1 for 60fps.
        const delta = ticker.deltaTime;

        this.gameTime += delta;
        this.waveTimer += delta;

        // --- 1. Player Movement ---
        this.updatePlayerMovement();

        // --- 2. Camera Follow ---
        const px = this.player.x;
        const py = this.player.y;
        
        this.world.pivot.x = px;
        this.world.pivot.y = py;
        this.world.position.x = SCREEN_WIDTH / 2;
        this.world.position.y = SCREEN_HEIGHT / 2;

        // --- 3. Spawning ---
        this.handleSpawning();

        // --- 4. Weapon Firing ---
        this.handleWeapons(delta);

        // --- 5. Entity Updates ---
        this.updateEnemies(delta);
        this.updateBullets(delta);
        this.updateParticles(delta);
        this.updateXP(delta);

        // --- 6. Collision ---
        this.handleCollisions();

        // --- 7. Stats to React ---
        // Throttle updates
        if (Math.floor(this.gameTime) % 10 === 0) {
            this.onUpdateStats({ ...this.stats, hp: this.player.hp, maxHp: this.player.maxHp });
        }
    }

    updatePlayerMovement() {
        if (this.isMoveMode) {
            const dx = this.mouse.x - (SCREEN_WIDTH / 2);
            const dy = this.mouse.y - (SCREEN_HEIGHT / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 10) {
                this.player.vx = (dx / dist) * this.stats.speed;
                this.player.vy = (dy / dist) * this.stats.speed;
            } else {
                this.player.vx = 0;
                this.player.vy = 0;
            }
        }
        this.player.x += this.player.vx;
        this.player.y += this.player.vy;
    }

    handleSpawning() {
        if (this.waveTimer > 1800) {
            this.wave++;
            this.waveTimer = 0;
            if (this.wave % 10 === 0) {
                this.onBossWarning(`Level ${this.wave} BOSS`);
                this.spawnEnemy(true);
            }
        }
        const spawnChance = 0.02 + (this.wave * 0.005);
        if (Math.random() < spawnChance) {
            this.spawnEnemy(false);
        }
    }

    spawnEnemy(isBoss: boolean) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 600 + Math.random() * 200; // Just offscreen
        const x = this.player.x + Math.cos(angle) * dist;
        const y = this.player.y + Math.sin(angle) * dist;

        const cont = new Container() as Entity;
        const g = new Graphics();
        
        // Visuals based on wave/boss
        const color = isBoss ? 0xff0000 : (this.wave % 2 === 0 ? 0x00ff00 : 0xffaa00);
        const size = isBoss ? 40 : (10 + Math.min(this.wave, 20));

        g.beginFill(color);
        if (this.wave > 50) {
            // Cool shape for high levels
            g.drawStar(0, 0, 5, size, size/2);
        } else {
            g.drawCircle(0, 0, size);
        }
        g.endFill();

        cont.addChild(g);
        cont.x = x;
        cont.y = y;
        cont.maxHp = isBoss ? 500 * this.wave : (2 + this.wave * 2);
        cont.hp = cont.maxHp;
        cont.radius = size;
        cont.isDead = false;
        cont.vx = 0; 
        cont.vy = 0;
        
        cont.isBurning = false;
        cont.isWet = false;
        cont.isElectrified = false;
        cont.burnTimer = 0;
        cont.wetTimer = 0;

        this.enemies.push(cont);
        this.world.addChild(cont);
    }

    // --- WEAPON SYSTEM ---
    weaponCooldowns: { [key: string]: number } = {};

    handleWeapons(delta: number) {
        let modifiers: { logic: string, count: number }[] = [];
        let buffStats = {
            rangeMult: 1,
            speedMult: 1,
            freqMult: 1
        };

        for (const card of this.stats.inventory) {
            if (card.type === CardType.EFFECT && card.effectConfig) {
                modifiers.push({ 
                    logic: card.effectConfig.logic, 
                    count: card.effectConfig.influenceCount 
                });
            } else if (card.type === CardType.BUFF && card.buffConfig) {
                if (card.buffConfig.range) buffStats.rangeMult += card.buffConfig.range;
                if (card.buffConfig.speed) buffStats.speedMult += card.buffConfig.speed;
                if (card.buffConfig.frequency) buffStats.freqMult += card.buffConfig.frequency;
            } else if (card.type === CardType.ARTIFACT && card.artifactConfig) {
                if (!this.weaponCooldowns[card.id]) this.weaponCooldowns[card.id] = 0;
                
                this.weaponCooldowns[card.id] -= delta * buffStats.freqMult;

                if (this.weaponCooldowns[card.id] <= 0) {
                    this.fireWeapon(card, modifiers, buffStats);
                    this.weaponCooldowns[card.id] = card.artifactConfig.cooldown;
                }

                modifiers = modifiers.map(m => ({ ...m, count: m.count - 1 })).filter(m => m.count > 0);
                buffStats = { rangeMult: 1, speedMult: 1, freqMult: 1 };
            }
        }
    }

    fireWeapon(card: CardDef, modifiers: { logic: string }[], buffs: any) {
        if (!card.artifactConfig) return;
        const conf = card.artifactConfig;
        
        let isFan = false;
        let isRing = false;
        let isBack = false;
        let track = false;
        let double = false;

        modifiers.forEach(m => {
            if (m.logic === 'double') double = true;
            if (m.logic === 'split_back') isBack = true;
            if (m.logic === 'fan') isFan = true;
            if (m.logic === 'ring') isRing = true;
            if (m.logic === 'track') track = true;
        });

        const fireCount = double ? 2 : 1;
        
        for (let fc = 0; fc < fireCount; fc++) {
             const dx = this.mouse.x - (SCREEN_WIDTH / 2);
             const dy = this.mouse.y - (SCREEN_HEIGHT / 2);
             let baseAngle = Math.atan2(dy, dx);
             
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
                 angles.push(baseAngle + Math.PI);
             }

             angles.forEach(angle => {
                 this.createBullet(conf, angle, buffs, track, card.id);
             });
        }
    }

    createBullet(conf: any, angle: number, buffs: any, tracking: boolean, ownerId: string) {
        const b = new Container() as Bullet;
        const g = new Graphics();
        
        let speed = 5 * buffs.speedMult;
        let life = 60 * buffs.rangeMult;
        
        g.beginFill(conf.color);
        if (conf.projectileType === 'projectile') {
            g.drawCircle(0, 0, 5);
        } else if (conf.projectileType === 'beam') {
            g.drawRect(0, -5, 40, 10);
            speed = 10 * buffs.speedMult;
        } else if (conf.projectileType === 'area') {
            g.moveTo(0,0);
            g.arc(0,0, 100 * buffs.rangeMult, -0.5, 0.5); 
            g.lineTo(0,0);
            g.alpha = 0.5;
            life = 10; 
            speed = 0; 
            if (conf.element === ElementType.FIRE) speed = 3; 
        } else if (conf.projectileType === 'orbit') {
            g.drawRect(-5, -20, 10, 40); 
            speed = 0;
            life = 9999; 
        } else if (conf.projectileType === 'lightning') {
            speed = 0;
            life = 5;
        }
        g.endFill();

        b.addChild(g);
        
        if (conf.projectileType === 'orbit') {
            b.x = this.player.x;
            b.y = this.player.y;
        } else {
            b.x = this.player.x;
            b.y = this.player.y;
        }

        b.vx = Math.cos(angle) * speed;
        b.vy = Math.sin(angle) * speed;
        b.rotation = angle;
        
        b.damage = conf.baseDamage * this.stats.damageMultiplier;
        b.element = conf.element;
        b.duration = life;
        b.radius = 10;
        b.ownerId = ownerId;
        b.isDead = false;
        b.isTracking = tracking;
        b.hitList = new Set();
        b.pierce = (conf.projectileType === 'area' || conf.projectileType === 'orbit') ? 999 : 1;

        this.bullets.push(b);
        this.world.addChild(b);
    }

    createTrail(color: number) {
        return new Container(); 
    }

    updateEnemies(delta: number) {
        const playerPos = { x: this.player.x, y: this.player.y };
        
        this.enemies.forEach(e => {
            if (e.isDead) return;

            const dx = playerPos.x - e.x;
            const dy = playerPos.y - e.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 10) {
                e.x += (dx / dist) * (1 + (this.wave * 0.01));
                e.y += (dy / dist) * (1 + (this.wave * 0.01));
            }

            if (e.isBurning) {
                e.hp -= 0.1;
                this.spawnParticle(e.x, e.y, 0xff4500);
            }

            if (e.hp <= 0) this.killEnemy(e);
        });

        this.enemies = this.enemies.filter(e => !e.isDead);
    }

    updateBullets(delta: number) {
        this.bullets.forEach(b => {
            if (b.isDead) return;
            b.duration -= delta;
            
            if (b.duration <= 0) {
                b.isDead = true;
                b.parent?.removeChild(b);
                return;
            }

            if (b.ownerId === 'art_sword_orbit') {
                b.rotation += 0.1;
                b.x = this.player.x + Math.cos(b.rotation) * 100;
                b.y = this.player.y + Math.sin(b.rotation) * 100;
            } else if (b.isTracking) {
                let nearest = null;
                let minDst = 1000;
                for (const e of this.enemies) {
                    const d = Math.hypot(e.x - b.x, e.y - b.y);
                    if (d < minDst) { minDst = d; nearest = e; }
                }
                if (nearest) {
                    const angle = Math.atan2(nearest.y - b.y, nearest.x - b.x);
                    b.vx = Math.cos(angle) * 5;
                    b.vy = Math.sin(angle) * 5;
                }
                b.x += b.vx;
                b.y += b.vy;
            } else {
                b.x += b.vx;
                b.y += b.vy;
            }
        });
        this.bullets = this.bullets.filter(b => !b.isDead);
    }

    updateParticles(delta: number) {
        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.alpha -= 0.05;
            p.life -= delta;
            if (p.life <= 0) {
                p.parent?.removeChild(p);
            }
        });
        this.particles = this.particles.filter(p => p.life > 0);
    }

    updateXP(delta: number) {
        this.xpOrbs.forEach(orb => {
            const dx = this.player.x - orb.x;
            const dy = this.player.y - orb.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < this.stats.pickupRange) {
                orb.x += (dx/dist) * 8;
                orb.y += (dy/dist) * 8;
                
                if (dist < 10) {
                    this.stats.xp += orb.value;
                    orb.parent?.removeChild(orb);
                    if (this.stats.xp >= this.stats.nextLevelXp) {
                        this.levelUp();
                    }
                }
            }
        });
        this.xpOrbs = this.xpOrbs.filter(o => o.parent);
    }

    handleCollisions() {
        for (const b of this.bullets) {
            if (b.isDead) continue;
            for (const e of this.enemies) {
                if (e.isDead) continue;
                if (b.hitList.has(this.getObjectId(e))) continue;

                const dx = b.x - e.x;
                const dy = b.y - e.y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < (b.radius + e.radius)) {
                    this.applyDamage(e, b);
                    b.hitList.add(this.getObjectId(e));
                    
                    b.pierce--;
                    if (b.pierce <= 0) {
                        b.isDead = true;
                        b.parent?.removeChild(b);
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
            e.x += Math.cos(angle) * 20;
            e.y += Math.sin(angle) * 20;
            
            if (e.isBurning) {
                e.isBurning = false; 
                dmg *= 0.5; 
            }
        }

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

        e.hp -= dmg;
        this.spawnText(Math.round(dmg).toString(), e.x, e.y - 20, 0xffffff);
    }

    triggerChainLightning(source: Entity, dmg: number) {
        this.enemies.forEach(target => {
            if (target === source) return;
            const d = Math.hypot(target.x - source.x, target.y - source.y);
            if (d < 100) {
                target.hp -= dmg * 0.5;
                const g = new Graphics();
                g.moveTo(source.x, source.y);
                g.lineTo(target.x, target.y);
                g.stroke({ width: 2, color: 0xffff00 }); // v8 stroke API
                this.world.addChild(g);
                setTimeout(() => g.parent?.removeChild(g), 100);
            }
        });
    }

    killEnemy(e: Entity) {
        e.isDead = true;
        this.world.removeChild(e);
        
        const orb = new Graphics() as XPOrb;
        let color = 0x888888;
        let size = 4;
        const val = 1 + (this.wave * 0.5);
        
        if (this.wave > 10) { color = 0x00ff00; size = 6; }
        if (this.wave > 30) { color = 0x0000ff; size = 8; }
        if (this.wave > 80) { color = 0xff00ff; size = 12; }

        orb.beginFill(color);
        orb.drawRect(-size/2, -size/2, size, size);
        orb.endFill();
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

    levelUp() {
        this.state = GameState.LEVEL_UP;
        this.onGameStateChange(GameState.LEVEL_UP);
        this.stats.level++;
        this.stats.xp = 0;
        this.stats.nextLevelXp = Math.floor(this.stats.nextLevelXp * 1.5);
    }

    spawnText(text: string, x: number, y: number, color: number) {
        const t = new Text({
            text: text,
            style: {
                fontFamily: 'PixelFont',
                fontSize: 14,
                fill: color,
                align: 'center'
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
            }
        };
        this.app.ticker.add(anim);
    }

    spawnParticle(x: number, y: number, color: number, count = 3) {
        for(let i=0; i<count; i++) {
            const p = new Graphics() as Particle;
            p.beginFill(color);
            p.drawRect(0,0, 2,2);
            p.endFill();
            p.x = x;
            p.y = y;
            p.vx = (Math.random()-0.5) * 4;
            p.vy = (Math.random()-0.5) * 4;
            p.life = 20;
            this.particles.push(p);
            this.world.addChild(p);
        }
    }

    addCard(card: CardDef) {
        if (card.type === CardType.STAT && card.statBonus) {
            if (card.statBonus.hpPercent) this.stats.maxHp *= (1 + card.statBonus.hpPercent);
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
        window.removeEventListener('keyup', this.handleKeyUp);
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mousedown', this.handleMouseDown);
    }
}