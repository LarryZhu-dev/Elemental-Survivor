
import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { GameEngine } from './engine';
import { GameState, MapType, PlayerStats, CardDef, CardType, Rarity } from './types';
import { getRandomCard, ALL_CARDS } from './constants';
import Muuri from 'muuri';

// Extend window for gm
declare global {
    interface Window {
        gm: () => void;
    }
}

interface SpellBoardProps {
    items: CardDef[];
    layoutMap: {[id: string]: number}; // Maps card ID to row index (0-3)
    onHover: (item: CardDef | null) => void;
}

// Fixed number of rows for spell chains
const ROW_COUNT = 4;

const SpellBoard = forwardRef((props: SpellBoardProps, ref) => {
    const { items, layoutMap, onHover } = props;
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
    const gridsRef = useRef<any[]>([]);
    
    // Split items into buckets based on layoutMap
    // Memoize this calculation so we don't re-calculate on every render unless props change
    // However, since we need to render the DOM elements for Muuri to pick up, we do this in render.
    const buckets: CardDef[][] = Array.from({ length: ROW_COUNT }, () => []);
    
    items.forEach(item => {
        let rowIndex = layoutMap[item.id];
        // If no saved layout, default to row 0 (or distribute if we wanted smart defaults)
        // Let's just put new items in the first row that isn't "full" visually, or just Row 0.
        // For simplicity, default to Row 0.
        if (rowIndex === undefined || rowIndex < 0 || rowIndex >= ROW_COUNT) {
             rowIndex = 0;
        }
        buckets[rowIndex].push(item);
    });

    useImperativeHandle(ref, () => ({
        // Returns both the linear order (for Engine) and the layout map (for UI persistence)
        getLayoutData: () => {
            const newOrder: string[] = [];
            const newLayoutMap: {[id: string]: number} = {};

            gridsRef.current.forEach((grid, rowIndex) => {
                if (!grid) return;
                const gridItems = grid.getItems();
                gridItems.forEach((item: any) => {
                    const id = item.getElement().getAttribute('data-id');
                    if (id) {
                        newOrder.push(id);
                        newLayoutMap[id] = rowIndex;
                    }
                });
            });
            
            return { newOrder, newLayoutMap };
        }
    }));

    useEffect(() => {
        // Init Muuri for each row
        const grids: any[] = [];
        
        rowRefs.current.forEach((el, i) => {
            if (!el) return;
            
            // Destroy existing if any (react strict mode double invoke protection)
            // But we ideally clear gridsRef on cleanup
        });

        // Cleanup previous instances first
        gridsRef.current.forEach(g => g.destroy());
        gridsRef.current = [];

        rowRefs.current.forEach((el, i) => {
            if (!el) return;
            const grid = new Muuri(el, {
                dragEnabled: true,
                items: '.item',
                dragContainer: document.body, 
                dragSort: () => gridsRef.current, // Sort among all active grids
                layout: {
                    fillGaps: true,
                    horizontal: true, // Use horizontal layout within rows for "Chain" feel
                    alignRight: false,
                    alignBottom: false,
                    rounding: false
                },
                dragStartPredicate: {
                    distance: 10,
                    delay: 0
                }
            });
            grids.push(grid);
        });

        gridsRef.current = grids;

        return () => {
            gridsRef.current.forEach(g => g.destroy());
            gridsRef.current = [];
        };
    }, [items]); // Re-init when items change (e.g. from GM add)

    return (
        <div className="spell-board-container">
             {buckets.map((bucketItems, rowIndex) => (
                 <div key={rowIndex}>
                     <div className="spell-row-label">法术组 {rowIndex + 1}</div>
                     <div className="spell-row" ref={el => rowRefs.current[rowIndex] = el}>
                        {bucketItems.map((card) => (
                            <div key={card.id} className="item" data-id={card.id}>
                                <div 
                                    className={`item-content rarity-${card.rarity}`}
                                    onMouseEnter={() => onHover(card)}
                                    onMouseLeave={() => onHover(null)}
                                    onTouchStart={() => onHover(card)}
                                >
                                     {card.type === CardType.EFFECT && <div className="badge badge-effect">EF</div>}
                                     {card.type === CardType.BUFF && <div className="badge badge-buff">BF</div>}
                                     {card.type === CardType.ARTIFACT && <div className="badge badge-art">ART</div>}
                                     
                                     <span style={{ color: card.iconColor, fontWeight: 'bold' }}>
                                         {card.name.substring(0,2)}
                                     </span>
                                </div>
                            </div>
                        ))}
                     </div>
                 </div>
             ))}
        </div>
    );
});

const Joystick = ({ onMove }: { onMove: (x: number, y: number) => void }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const knobRef = useRef<HTMLDivElement>(null);
    const touchIdRef = useRef<number | null>(null);

    const handleStart = (e: React.TouchEvent) => {
        const touch = e.changedTouches[0] as React.Touch;
        touchIdRef.current = touch.identifier;
        updateJoystick(touch.clientX, touch.clientY);
    };

    const handleMove = (e: React.TouchEvent) => {
        const touches = Array.from(e.changedTouches) as React.Touch[];
        const touch = touches.find(t => t.identifier === touchIdRef.current);
        if (touch) {
            updateJoystick(touch.clientX, touch.clientY);
        }
    };

    const handleEnd = (e: React.TouchEvent) => {
        const touches = Array.from(e.changedTouches) as React.Touch[];
        const touch = touches.find(t => t.identifier === touchIdRef.current);
        if (touch) {
            touchIdRef.current = null;
            resetJoystick();
        }
    };

    const updateJoystick = (clientX: number, clientY: number) => {
        if (!containerRef.current || !knobRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const maxDist = rect.width / 2;
        
        let dx = clientX - centerX;
        let dy = clientY - centerY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        // Clamp
        if (dist > maxDist) {
            dx = (dx / dist) * maxDist;
            dy = (dy / dist) * maxDist;
        }
        
        // Move knob visually
        knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        
        // Normalize output -1 to 1
        onMove(dx / maxDist, dy / maxDist);
    };

    const resetJoystick = () => {
        if (!knobRef.current) return;
        knobRef.current.style.transform = `translate(-50%, -50%)`;
        onMove(0, 0);
    };

    return (
        <div 
            className="joystick-container"
            ref={containerRef}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
            onTouchCancel={handleEnd}
        >
            <div className="joystick-knob" ref={knobRef} />
        </div>
    );
};


const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const spellBoardRef = useRef<any>(null);

  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUpOptions, setLevelUpOptions] = useState<CardDef[]>([]);
  const [bossWarning, setBossWarning] = useState<string | null>(null);
  const [aimStatus, setAimStatus] = useState<string>("自动");
  const [isGmMode, setIsGmMode] = useState(false);
  
  // Layout State for Spell Board persistence
  const [layoutMap, setLayoutMap] = useState<{[id: string]: number}>({});

  // Hover state for inventory details
  const [hoveredCard, setHoveredCard] = useState<CardDef | null>(null);

  useEffect(() => {
     window.gm = () => {
         setIsGmMode(prev => !prev);
     };
  }, []);

  // Initialize Engine
  useEffect(() => {
    if (!canvasRef.current) return;
    
    if (engineRef.current) return;

    const engine = new GameEngine(
      canvasRef.current,
      (newStats) => setStats({...newStats}), 
      (newState) => {
          setGameState(newState);
          if (newState === GameState.LEVEL_UP) {
              const wave = engineRef.current?.wave || 1;
              const inv = engineRef.current?.stats.inventory || [];
              const opts: CardDef[] = [];
              
              for(let i=0; i<3; i++) {
                  const card = getRandomCard(wave, inv, opts); 
                  opts.push(card);
              }
              
              setLevelUpOptions(opts);
          }
      },
      (name) => {
          setBossWarning(name);
          setTimeout(() => setBossWarning(null), 3000);
      },
      (isAuto) => {
          setAimStatus(isAuto ? "自动" : "手动");
      }
    );
    engineRef.current = engine;
    
    const initEngine = async () => {
        try {
            await engine.init();
        } catch (e: any) {
            console.error("Engine Init Failed", e);
        }
    };
    
    initEngine();

    return () => {
      if (engineRef.current) {
          engineRef.current.destroy();
          engineRef.current = null;
      }
    };
  }, []);

  const startGame = (mapType: MapType) => {
    engineRef.current?.start(mapType);
  };

  const selectCardForInventory = (card: CardDef) => {
    // Clone to ensure unique ID if added from GM mode multiple times
    const newCard = { ...card, id: Math.random().toString(36).substr(2, 9) };
    engineRef.current?.addCard(newCard);
    
    if (gameState === GameState.LEVEL_UP) {
        engineRef.current?.resume();
        setGameState(GameState.PLAYING);
    } else {
        // GM Mode update stats immediately
        if (engineRef.current) {
           setStats({ ...engineRef.current.stats });
        }
    }
  };

  const gmRemoveCard = (index: number) => {
      engineRef.current?.debugRemoveCard(index);
      if (engineRef.current) setStats({ ...engineRef.current.stats });
  };

  const gmSetWave = (e: any) => {
      const w = parseInt(e.target.value);
      if (!isNaN(w)) {
          engineRef.current?.debugSetWave(w);
      }
  };

  const handleResume = () => {
      if (spellBoardRef.current && stats && engineRef.current) {
          const { newOrder, newLayoutMap } = spellBoardRef.current.getLayoutData();
          
          // Save UI layout persistence
          setLayoutMap(newLayoutMap);

          // Reconstruct inventory based on IDs for the engine logic (linear execution)
          const map = new Map(stats.inventory.map(c => [c.id, c]));
          const newInventory = newOrder.map((id: string) => map.get(id)).filter(Boolean) as CardDef[];
          
          // Append any missing items (safety check)
          const currentIds = new Set(newOrder);
          const missing = stats.inventory.filter(c => !currentIds.has(c.id));
          const finalInventory = [...newInventory, ...missing];
          
          engineRef.current.reorderInventory(finalInventory);
          setStats({ ...engineRef.current.stats });
      }

      setGameState(GameState.PLAYING);
      engineRef.current?.resume();
      setHoveredCard(null);
  };

  const handleJoystickMove = (x: number, y: number) => {
      if (engineRef.current) {
          engineRef.current.setJoystick(x, y);
      }
  };

  const handlePause = () => {
      if (gameState === GameState.PLAYING) {
          setGameState(GameState.PAUSED);
      }
  };

  return (
    <div className="app-container">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* --- MENU --- */}
      {gameState === GameState.MENU && (
        <div className="absolute inset-0 overlay-bg flex flex-col items-center justify-center gap-6 z-50">
          <h1 className="menu-title mb-8">元素幸存者</h1>
          <div className="flex flex-col gap-4">
            <button 
              onClick={() => startGame(MapType.FIXED)}
              className="btn btn-fixed"
            >
              开始游戏
            </button>
          </div>
          <div className="instructions mt-8 text-center">
            点击地面或使用摇杆移动.<br/>
            按 [A] 键切换手动/自动瞄准.<br/>
            Esc/右上角按钮 暂停整理背包.<br/>
          </div>
        </div>
      )}

      {/* --- HUD --- */}
      {(gameState === GameState.PLAYING || gameState === GameState.PRE_LEVEL_UP) && stats && (
        <>
        <div className="absolute inset-0 pointer-events-none p-4">
           {/* Boss Warning */}
           {bossWarning && (
             <div className="absolute top-20 left-1/2 transform -translate-x-1/2 text-red-500 font-bold text-3xl animate-pulse">
               {bossWarning}
             </div>
           )}

           {/* Aim Status */}
           <div className="aim-status">
               瞄准: {aimStatus} [A]
           </div>

           {/* HP Bar */}
           <div className="bar-container bar-hp">
             <div 
               className="bar-fill fill-red" 
               style={{ width: `${Math.max(0, (stats.hp / stats.maxHp) * 100)}%` }} 
             />
             <span className="hp-text">
                {Math.ceil(Math.max(0, stats.hp))} / {Math.ceil(stats.maxHp)}
             </span>
           </div>
           
           {/* XP Bar */}
           <div className="bar-container bar-xp">
             <div 
               className="bar-fill fill-yellow" 
               style={{ width: `${(stats.xp / stats.nextLevelXp) * 100}%` }} 
             />
           </div>
           <div className="lvl-text">
             LV {stats.level}
           </div>

           {/* Wave Info */}
           <div className="wave-info">
             <div className="wave-title">WAVE {engineRef.current?.wave}</div>
             <div className="wave-timer">
                Left: {engineRef.current?.waveTotalEnemies && engineRef.current.waveEnemiesSpawned !== undefined 
                  ? Math.max(0, engineRef.current.waveTotalEnemies - engineRef.current.waveEnemiesSpawned + engineRef.current.enemies.length)
                  : 0}
             </div>
           </div>
        </div>

        {/* Mobile Controls */}
        <Joystick onMove={handleJoystickMove} />
        
        <button className="pause-btn" onClick={handlePause}>
            PAUSE
        </button>
        </>
      )}

      {/* --- PAUSE / LEVEL UP / GAME OVER / VICTORY OVERLAYS --- */}
      {(gameState === GameState.PAUSED || gameState === GameState.LEVEL_UP || gameState === GameState.GAME_OVER || gameState === GameState.VICTORY) && (
          <div className="absolute inset-0 overlay-bg flex flex-col items-center justify-center gap-4 z-50 p-8">
              <h2 className="menu-title text-2xl">
                  {gameState === GameState.PAUSED ? "已暂停" : 
                   gameState === GameState.LEVEL_UP ? "升级!" : 
                   gameState === GameState.GAME_OVER ? "游戏结束" : "胜利!"}
              </h2>

              {/* Spell Board for Inventory Management */}
              {stats && (gameState === GameState.PAUSED || gameState === GameState.LEVEL_UP) && (
                  <div className="w-full max-w-4xl bg-black/50 p-4 rounded-lg overflow-y-auto" style={{maxHeight: '60vh'}}>
                      <div className="mb-2 text-center text-white/70">拖拽调整法术施放顺序 (从左到右，从上到下)</div>
                      <SpellBoard 
                        ref={spellBoardRef}
                        items={stats.inventory}
                        layoutMap={layoutMap}
                        onHover={setHoveredCard}
                      />
                  </div>
              )}

              {/* Hover Details (Fixed Position via CSS class) */}
              {hoveredCard && (
                  <div className="card-detail-tooltip">
                      <div className="font-bold text-lg" style={{color: hoveredCard.iconColor}}>{hoveredCard.name}</div>
                      <div className="text-sm text-white/80">{hoveredCard.description}</div>
                  </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap justify-center gap-4 mt-4">
                  {gameState === GameState.PAUSED && (
                      <button className="btn btn-primary" onClick={handleResume}>继续游戏</button>
                  )}
                  
                  {gameState === GameState.LEVEL_UP && levelUpOptions.map((card) => (
                      <div 
                        key={card.id}
                        onClick={() => selectCardForInventory(card)}
                        className={`card rarity-${card.rarity}`}
                      >
                        <div className="card-icon">
                           <div style={{ color: card.iconColor }}>★</div>
                        </div>
                        <h3 className="card-name mb-2" style={{ color: card.iconColor }}>{card.name}</h3>
                        <p className="card-desc">{card.description}</p>
                        <div className="card-type">{card.type}</div>
                      </div>
                  ))}

                  {(gameState === GameState.GAME_OVER || gameState === GameState.VICTORY) && (
                      <button className="btn btn-danger" onClick={() => window.location.reload()}>返回主菜单</button>
                  )}
              </div>
              
              {/* GM Mode Tools */}
              {isGmMode && (
                  <div className="absolute top-4 left-4 p-4 bg-black/80 rounded border border-red-500 z-50">
                      <div className="text-red-500 font-bold mb-2">GM TOOLS</div>
                      <div>Set Wave: <input type="number" onChange={gmSetWave} className="text-black w-16"/></div>
                      <div className="mt-2 text-xs">Available Cards:</div>
                      <div className="flex flex-wrap gap-1 max-w-sm h-32 overflow-auto">
                          {ALL_CARDS.map(c => (
                              <button key={c.id} onClick={() => selectCardForInventory(c)} className="text-xs bg-gray-700 px-1 rounded">
                                  {c.name}
                              </button>
                          ))}
                      </div>
                      <div className="mt-2 text-xs">Inventory:</div>
                      <div className="flex flex-wrap gap-1 max-w-sm h-32 overflow-auto">
                           {stats?.inventory.map((c, i) => (
                               <button key={i} onClick={() => gmRemoveCard(i)} className="text-xs bg-red-900 px-1 rounded">
                                   X {c.name}
                               </button>
                           ))}
                      </div>
                  </div>
              )}
          </div>
      )}
    </div>
  );
};

export default App;
