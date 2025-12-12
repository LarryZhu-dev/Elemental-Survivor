
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

// Helper to keep track of hovered item for details panel
interface HoveredItem {
    card: CardDef;
}

interface InventoryGridProps {
    items: CardDef[];
    onHover: (item: CardDef | null) => void;
}

const InventoryGrid = forwardRef(({ items, onHover }: InventoryGridProps, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
        getOrder: () => {
            if (!gridRef.current) return [];
            // Get current order of elements
            const gridItems = gridRef.current.getItems();
            return gridItems.map((item: any) => item.getElement().getAttribute('data-id'));
        }
    }));

    useEffect(() => {
        if (!containerRef.current) return;

        // Init Muuri
        gridRef.current = new Muuri(containerRef.current, {
            dragEnabled: true,
            layoutOnInit: true,
            dragContainer: document.body, // Allows dragging outside the scrollable area visually
            dragSort: true,
            layout: {
                fillGaps: true,
                horizontal: false,
                alignRight: false,
                alignBottom: false,
                rounding: false
            }
        });

        // Cleanup
        return () => {
            if (gridRef.current) {
                gridRef.current.destroy();
                gridRef.current = null;
            }
        };
    }, []); // Only init once. We rebuild on re-mount of parent (Pause/Resume cycle)

    return (
        <div className="grid-container-wrapper">
             <div ref={containerRef} className="grid">
                {items.map((card) => (
                    <div key={card.id} className="item" data-id={card.id}>
                        <div 
                            className={`item-content rarity-${card.rarity}`}
                            onMouseEnter={() => onHover(card)}
                            onMouseLeave={() => onHover(null)}
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
    );
});


const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const gridComponentRef = useRef<any>(null);

  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUpOptions, setLevelUpOptions] = useState<CardDef[]>([]);
  const [bossWarning, setBossWarning] = useState<string | null>(null);
  const [aimStatus, setAimStatus] = useState<string>("自动");
  const [isGmMode, setIsGmMode] = useState(false);
  
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
      if (gridComponentRef.current && stats && engineRef.current) {
          const newOrderIds: string[] = gridComponentRef.current.getOrder();
          
          // Reconstruct inventory based on IDs
          const map = new Map(stats.inventory.map(c => [c.id, c]));
          const newInventory = newOrderIds.map(id => map.get(id)).filter(Boolean) as CardDef[];
          
          // Append any missing items (safety check)
          const currentIds = new Set(newOrderIds);
          const missing = stats.inventory.filter(c => !currentIds.has(c.id));
          const finalInventory = [...newInventory, ...missing];
          
          engineRef.current.reorderInventory(finalInventory);
          setStats({ ...engineRef.current.stats });
      }

      setGameState(GameState.PLAYING);
      engineRef.current?.resume();
      setHoveredCard(null);
  };

  return (
    <div className="app-container">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* --- MENU --- */}
      {gameState === GameState.MENU && (
        <div className="absolute inset-0 overlay-bg flex flex-col items-center justify-center gap-6">
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
            点击地面移动. 默认自动攻击最近敌人.<br/>
            按 [A] 键切换手动/自动瞄准.<br/>
            Esc 暂停/整理背包.<br/>
            (在控制台输入 gm() 开启调试模式)
          </div>
        </div>
      )}

      {/* --- HUD --- */}
      {(gameState === GameState.PLAYING || gameState === GameState.PRE_LEVEL_UP) && stats && (
        <div className="absolute inset-0 pointer-events-none p-4">
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
      )}

      {/* --- GM PANEL --- */}
      {isGmMode && (
          <div className="gm-panel z-100 pointer-events-auto">
              <div className="gm-header flex justify-between">
                  <span>GM DEBUG PANEL</span>
                  <button className="btn-sm" onClick={() => setIsGmMode(false)}>X</button>
              </div>
              
              <div className="gm-section">
                  <div className="gm-label">Current Wave</div>
                  <input type="number" className="bg-gray-700 text-white p-1" onChange={gmSetWave} defaultValue={engineRef.current?.wave} />
              </div>

              <div className="gm-section">
                  <div className="gm-label">Add Card (Click to Add)</div>
                  <div className="gm-card-grid">
                      {ALL_CARDS.map(c => (
                          <button key={c.id} className="gm-card-btn" onClick={() => selectCardForInventory(c)}>
                              {c.name}
                          </button>
                      ))}
                  </div>
              </div>

              <div className="gm-section">
                  <div className="gm-label">Current Inventory (Click to Remove)</div>
                  <div className="gm-card-grid">
                      {stats?.inventory.map((c, i) => (
                          <button key={c.id} className="gm-card-btn btn-red" onClick={() => gmRemoveCard(i)}>
                              {i+1}. {c.name}
                          </button>
                      ))}
                  </div>
              </div>
          </div>
      )}

      {/* --- BOSS WARNING --- */}
      {bossWarning && (
         <div className="absolute inset-0 flex items-center justify-center pointer-events-none boss-overlay">
            <div className="boss-text">
               警告: {bossWarning}
            </div>
         </div>
      )}

      {/* --- LEVEL UP --- */}
      {gameState === GameState.LEVEL_UP && (
        <div className="absolute inset-0 overlay-darker flex flex-col items-center justify-center z-50">
          <h2 className="levelup-title mb-8">等级提升!</h2>
          <div className="flex gap-4">
            {levelUpOptions.map((card, i) => (
              <div 
                key={i}
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
          </div>
        </div>
      )}

      {/* --- PAUSE / INVENTORY --- */}
      {gameState === GameState.PAUSED && stats && (
         <div className="absolute inset-0 pause-overlay flex flex-col items-center justify-center z-40">
           <h2 className="pause-title mb-4">法术链调整 (Grid Layout)</h2>
           <p className="pause-desc mb-4">
             法术触发顺序：从左到右，从上到下。<br/>
             请将 Buff 和 Effect 放在核心法器 (ART) 之前。
           </p>
           
           <div className="pause-layout">
               <InventoryGrid 
                    ref={gridComponentRef} 
                    items={stats.inventory} 
                    onHover={setHoveredCard}
               />

               {/* Details Panel */}
               <div className="details-panel">
                   {hoveredCard ? (
                       <>
                           <div className="details-title" style={{color: hoveredCard.iconColor}}>{hoveredCard.name}</div>
                           <div className="details-type">{hoveredCard.type} - {hoveredCard.rarity}</div>
                           <div className="details-desc">{hoveredCard.description}</div>
                       </>
                   ) : (
                       <div className="text-gray-500 italic flex h-full items-center justify-center">
                            将鼠标悬停在卡片上查看详情。<br/>
                            拖动卡片以排序。
                       </div>
                   )}
               </div>
           </div>

           <button 
             onClick={handleResume}
             className="btn-resume mt-4"
           >
             保存并继续
           </button>
         </div>
      )}

      {/* --- GAME OVER --- */}
      {gameState === GameState.GAME_OVER && (
          <div className="absolute inset-0 overlay-darker flex flex-col items-center justify-center z-50">
             <h1 className="text-red-500 text-6xl font-bold mb-4">GAME OVER</h1>
             <p className="text-white text-xl mb-8">你倒下了...</p>
             <button onClick={() => window.location.reload()} className="btn btn-fixed">
               重新开始
             </button>
          </div>
      )}

      {/* --- VICTORY --- */}
      {gameState === GameState.VICTORY && (
          <div className="absolute inset-0 victory-overlay flex flex-col items-center justify-center z-50">
             <h1 className="victory-title mb-8">胜利!</h1>
             <p className="victory-subtitle mb-8">你击败了终极 BOSS.</p>
             <div className="cast-box mb-8">
                <h3 className="cast-title mb-4">Cast</h3>
                <p>Producer: You</p>
                <p>Engine: Pixi.js</p>
                <p>UI: React</p>
                <p>Thank you for playing!</p>
             </div>
             <button onClick={() => window.location.reload()} className="btn-replay mt-8">再玩一次</button>
          </div>
      )}
    </div>
  );
};

export default App;
