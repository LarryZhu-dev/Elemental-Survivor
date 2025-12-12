import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine';
import { GameState, MapType, PlayerStats, CardDef, CardType, Rarity } from './types';
import { getRandomCard, STAT_CARDS, COLORS } from './constants';
import Muuri from 'muuri';

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUpOptions, setLevelUpOptions] = useState<CardDef[]>([]);
  const [bossWarning, setBossWarning] = useState<string | null>(null);
  const [aimStatus, setAimStatus] = useState<string>("自动");
  const [selectedCard, setSelectedCard] = useState<CardDef | null>(null);
  
  // Muuri Grid Ref
  const gridRef = useRef<Muuri | null>(null);
  const gridElementRef = useRef<HTMLDivElement>(null);

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

  // Initialize Muuri when entering Pause state
  useEffect(() => {
    if (gameState === GameState.PAUSED && gridElementRef.current && !gridRef.current) {
        setTimeout(() => {
            if (!gridElementRef.current) return;
            gridRef.current = new Muuri(gridElementRef.current, {
                dragEnabled: true,
                layout: {
                    fillGaps: true
                },
                dragSort: true,
                dragStartPredicate: {
                    distance: 10,
                    delay: 0,
                }
            });
            
            // Re-calc highlights on drag end
            gridRef.current.on('dragEnd', () => {
               // Trigger a re-render or state update to refresh highlights if needed
               // For now, react state update on resume handles logic, 
               // visuals in drag might need raw DOM manipulation or force update
               // but react won't re-render items inside muuri easily without destruction.
               // We will rely on static rendering of highlights based on order.
               // Since Muuri changes DOM order, we need to sync state to see highlights update?
               // Realtime update with Muuri + React is tricky. 
               // For this task, we'll sync on resume, but we can try to sync on drop if we want live range updates.
               syncInventoryFromMuuri(); 
            });

        }, 100);
    }

    return () => {
        if (gameState !== GameState.PAUSED && gridRef.current) {
            gridRef.current.destroy();
            gridRef.current = null;
        }
    };
  }, [gameState]);

  const syncInventoryFromMuuri = () => {
      if (!gridRef.current || !engineRef.current || !stats) return;
      
      const items = gridRef.current.getItems();
      const newInventory: CardDef[] = [];
      
      items.forEach(item => {
          const el = item.getElement();
          if (el) {
              const id = el.getAttribute('data-id');
              const card = stats.inventory.find(c => c.id === id);
              if (card) newInventory.push(card);
          }
      });
      
      if (newInventory.length === stats.inventory.length) {
          setStats({ ...stats, inventory: newInventory });
      }
  }

  const startGame = (mapType: MapType) => {
    engineRef.current?.start(mapType);
  };

  const selectCardForInventory = (card: CardDef) => {
    engineRef.current?.addCard(card);
    engineRef.current?.resume();
    setGameState(GameState.PLAYING);
  };

  const handleResume = () => {
      syncInventoryFromMuuri();
      if (stats) {
         engineRef.current?.reorderInventory(stats.inventory);
      }

      setGameState(GameState.PLAYING);
      engineRef.current?.resume();
      
      if (gridRef.current) {
          gridRef.current.destroy();
          gridRef.current = null;
      }
      setSelectedCard(null);
  };

  // Helper to determine if a slot is affected by previous effect cards
  // This mimics the Engine logic to show UI hints
  const getAffectedIndices = () => {
      if (!stats) return new Set<number>();
      
      const affected = new Set<number>();
      const activeEffects: { logic: string, count: number }[] = [];
      
      stats.inventory.forEach((card, index) => {
          let executionCount = 1;
          activeEffects.forEach(eff => {
              if (eff.logic === 'double') executionCount *= 2;
          });

          // If this card is being influenced, mark it
          if (activeEffects.length > 0) {
              affected.add(index);
          }

          if (card.type === CardType.EFFECT && card.effectConfig) {
             for(let i=0; i<executionCount; i++) {
                 activeEffects.push({
                     logic: card.effectConfig.logic,
                     count: card.effectConfig.influenceCount
                 });
             }
          }

          // Decrement counts
          activeEffects.forEach(eff => eff.count--);
          for(let i=activeEffects.length-1; i>=0; i--) {
              if (activeEffects[i].count <= 0) activeEffects.splice(i, 1);
          }
      });
      return affected;
  };

  const affectedIndices = getAffectedIndices();

  const renderInventory = () => {
      if (!stats) return null;

      return stats.inventory.map((card, index) => (
          <div
             key={card.id}
             data-id={card.id}
             className={`inv-slot rarity-${card.rarity} ${affectedIndices.has(index) ? 'is-affected' : ''}`}
             onClick={() => setSelectedCard(card)}
           >
             <div className="inv-slot-content w-full h-full flex items-center justify-center relative pointer-events-none">
                 {card.type === CardType.EFFECT && <span className="badge badge-effect">E</span>}
                 {card.type === CardType.BUFF && <span className="badge badge-buff">B</span>}
                 
                 <span style={{ color: card.iconColor, fontWeight: 'bold' }}>
                    {card.name.substring(0, 2)}
                 </span>
             </div>
           </div>
      ));
  }

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
            Esc 暂停/整理背包.
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
           <h2 className="pause-title mb-4">暂停 / 装备调整</h2>
           <p className="pause-desc mb-8">
             拖动卡片调整顺序。效果卡片(Effect)会影响排列在它后面的卡片。<br/>
             虚线框表示该卡片受到前方效果的影响。
           </p>
           
           <div className="pause-layout">
               <div ref={gridElementRef} className="inv-grid">
                 {renderInventory()}
               </div>

               {/* Details Panel */}
               <div className="details-panel">
                   {selectedCard ? (
                       <>
                           <div className="details-title" style={{ color: selectedCard.iconColor }}>
                               {selectedCard.name}
                           </div>
                           <div className="details-type">{selectedCard.rarity} {selectedCard.type}</div>
                           <div className="details-desc">{selectedCard.description}</div>
                           {selectedCard.type === CardType.EFFECT && (
                               <div className="mt-4 text-sm text-cyan-400">
                                   影响范围: {selectedCard.effectConfig?.influenceCount || 1} 格
                               </div>
                           )}
                       </>
                   ) : (
                       <div className="text-gray-500 italic">点击卡片查看详情</div>
                   )}
               </div>
           </div>

           <button 
             onClick={handleResume}
             className="btn-resume mt-8"
           >
             继续游戏
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