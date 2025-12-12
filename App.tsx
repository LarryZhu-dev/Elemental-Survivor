import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from './engine';
import { GameState, MapType, PlayerStats, CardDef, CardType } from './types';
import { getRandomCard, STAT_CARDS, COLORS } from './constants';

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUpOptions, setLevelUpOptions] = useState<CardDef[]>([]);
  const [bossWarning, setBossWarning] = useState<string | null>(null);
  
  // Initialize Engine
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const engine = new GameEngine(
      canvasRef.current,
      (newStats) => setStats({...newStats}), // Update stats
      (newState) => {
          setGameState(newState);
          if (newState === GameState.LEVEL_UP) {
              // Generate 3 random cards
              const wave = engineRef.current?.wave || 1;
              const opts = [getRandomCard(wave), getRandomCard(wave), getRandomCard(wave)];
              setLevelUpOptions(opts);
          }
      },
      (name) => {
          setBossWarning(name);
          setTimeout(() => setBossWarning(null), 3000);
      }
    );
    engineRef.current = engine;
    
    engine.init().catch(e => console.error("Engine Init Failed", e));

    return () => {
      engine.destroy();
    };
  }, []);

  const startGame = (mapType: MapType) => {
    engineRef.current?.start(mapType);
  };

  const selectCard = (card: CardDef) => {
    engineRef.current?.addCard(card);
    engineRef.current?.resume();
    setGameState(GameState.PLAYING);
  };

  // Drag and Drop Logic for Pause Menu
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("index", index.toString());
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    const dragIndex = parseInt(e.dataTransfer.getData("index"));
    if (isNaN(dragIndex) || !stats) return;

    const newInv = [...stats.inventory];
    const [moved] = newInv.splice(dragIndex, 1);
    newInv.splice(dropIndex, 0, moved);
    
    engineRef.current?.reorderInventory(newInv);
    setStats({ ...stats, inventory: newInv });
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  return (
    <div className="relative w-full h-screen overflow-hidden font-['PixelFont'] text-white select-none">
      <canvas ref={canvasRef} className="absolute top-0 left-0" />

      {/* --- MENU --- */}
      {gameState === GameState.MENU && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-6">
          <h1 className="text-6xl text-cyan-400 mb-8 drop-shadow-[0_4px_0_rgba(0,0,0,1)]">元素幸存者</h1>
          <div className="space-y-4 flex flex-col">
            <button 
              onClick={() => startGame(MapType.FIXED)}
              className="px-8 py-4 bg-gray-700 hover:bg-gray-600 border-4 border-white text-xl"
            >
              固定地图 (Fixed Map)
            </button>
            <button 
              onClick={() => startGame(MapType.INFINITE)}
              className="px-8 py-4 bg-gray-700 hover:bg-gray-600 border-4 border-purple-500 text-xl"
            >
              无限地图 (Infinite Map)
            </button>
          </div>
          <div className="mt-8 text-gray-400 text-sm max-w-md text-center">
            操作: 鼠标瞄准, F 键移动 (跟随鼠标), S 键站立.<br/>
            Esc 暂停/整理背包.
          </div>
        </div>
      )}

      {/* --- HUD --- */}
      {gameState === GameState.PLAYING && stats && (
        <div className="absolute inset-0 pointer-events-none p-4">
           {/* HP Bar */}
           <div className="absolute top-4 left-4 w-64 h-6 bg-gray-800 border-2 border-white">
             <div 
               className="h-full bg-red-500 transition-all duration-300" 
               style={{ width: `${(stats.hp / stats.maxHp) * 100}%` }} 
             />
             <span className="absolute inset-0 flex items-center justify-center text-xs drop-shadow-md">
                {Math.ceil(stats.hp)} / {Math.ceil(stats.maxHp)}
             </span>
           </div>
           
           {/* XP Bar */}
           <div className="absolute top-12 left-4 w-64 h-4 bg-gray-800 border-2 border-white">
             <div 
               className="h-full bg-yellow-400 transition-all duration-300" 
               style={{ width: `${(stats.xp / stats.nextLevelXp) * 100}%` }} 
             />
           </div>
           <div className="absolute top-12 left-[290px] text-yellow-400 font-bold text-xl">
             LV {stats.level}
           </div>

           {/* Wave Info */}
           <div className="absolute top-4 right-4 text-right">
             <div className="text-2xl text-red-400">WAVE {engineRef.current?.wave}</div>
             <div className="text-sm text-gray-400">
               {Math.floor((engineRef.current?.gameTime || 0) / 60)}:
               {Math.floor((engineRef.current?.gameTime || 0) % 60).toString().padStart(2, '0')}
             </div>
           </div>
        </div>
      )}

      {/* --- BOSS WARNING --- */}
      {bossWarning && (
         <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-red-900/30">
            <div className="text-6xl text-red-500 animate-pulse font-bold border-y-4 border-red-500 py-4 px-12 bg-black/50">
               警告: {bossWarning}
            </div>
         </div>
      )}

      {/* --- LEVEL UP --- */}
      {gameState === GameState.LEVEL_UP && (
        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-50">
          <h2 className="text-4xl text-yellow-300 mb-8">等级提升! 选择强化</h2>
          <div className="flex gap-4">
            {levelUpOptions.map((card, i) => (
              <div 
                key={i}
                onClick={() => selectCard(card)}
                className="w-48 h-64 bg-slate-800 border-4 hover:scale-105 transition-transform cursor-pointer p-4 flex flex-col"
                style={{ borderColor: card.iconColor }}
              >
                <div className="h-24 w-full mb-4 flex items-center justify-center bg-black/30 text-4xl">
                   {/* Placeholder Icon */}
                   <div style={{ color: card.iconColor }}>★</div>
                </div>
                <h3 className="text-lg font-bold mb-2" style={{ color: card.iconColor }}>{card.name}</h3>
                <p className="text-xs text-gray-300">{card.description}</p>
                <div className="mt-auto text-xs uppercase opacity-50 text-center">{card.type}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- PAUSE / INVENTORY --- */}
      {gameState === GameState.PAUSED && stats && (
         <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center z-40">
           <h2 className="text-4xl mb-4 text-white">暂停 / 装备调整</h2>
           <p className="text-sm text-gray-400 mb-8 max-w-lg text-center">
             拖动卡片调整顺序。效果卡片(Effect)会影响排列在它后面的技能(Artifact)。<br/>
             例如: [双重触发] -> [火葫芦] = 双倍火焰。
           </p>
           
           <div className="w-[800px] flex flex-wrap gap-2 p-4 border-2 border-gray-600 bg-gray-900 min-h-[200px]">
             {stats.inventory.map((card, index) => (
               <div
                 key={card.id}
                 draggable
                 onDragStart={(e) => handleDragStart(e, index)}
                 onDrop={(e) => handleDrop(e, index)}
                 onDragOver={handleDragOver}
                 className="w-16 h-16 bg-slate-700 border-2 flex items-center justify-center text-xs text-center cursor-grab active:cursor-grabbing relative group"
                 style={{ borderColor: card.iconColor }}
                 title={card.name + "\n" + card.description}
               >
                 {card.type === CardType.EFFECT && <span className="absolute top-0 right-0 text-[8px] bg-white text-black px-1">E</span>}
                 {card.type === CardType.BUFF && <span className="absolute top-0 right-0 text-[8px] bg-cyan-200 text-black px-1">B</span>}
                 {card.name.substring(0, 2)}
                 
                 {/* Hover Tooltip */}
                 <div className="absolute bottom-full mb-2 hidden group-hover:block w-32 bg-black border border-white p-2 z-50 pointer-events-none">
                    <div className="font-bold">{card.name}</div>
                    <div className="text-[10px]">{card.description}</div>
                 </div>
               </div>
             ))}
           </div>

           <button 
             onClick={() => {
                setGameState(GameState.PLAYING);
                engineRef.current?.resume();
             }}
             className="mt-8 px-8 py-2 bg-green-600 hover:bg-green-500 text-white border-2 border-green-300"
           >
             继续游戏
           </button>
         </div>
      )}

      {/* --- VICTORY --- */}
      {gameState === GameState.VICTORY && (
          <div className="absolute inset-0 bg-white text-black flex flex-col items-center justify-center z-50">
             <h1 className="text-8xl font-bold mb-8">胜利!</h1>
             <p className="text-2xl mb-8">你击败了终极 BOSS.</p>
             <div className="bg-gray-100 p-8 border-4 border-black text-center">
                <h3 className="text-xl font-bold mb-4">Cast</h3>
                <p>Producer: You</p>
                <p>Engine: Pixi.js</p>
                <p>UI: React</p>
                <p>Thank you for playing!</p>
             </div>
             <button onClick={() => window.location.reload()} className="mt-8 underline">再玩一次</button>
          </div>
      )}
    </div>
  );
};

export default App;