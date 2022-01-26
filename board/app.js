function main(){

// ==== INIT ====
function parseQueryParams(){
    let search = location.search.substring(1);
    if (!search) return {};
    return JSON.parse('{"' + decodeURI(search).replace(/"/g, '\\"').replace(/&/g, '","').replace(/=/g,'":"') + '"}');
}

let { username } = parseQueryParams();
username = "DrNykterstein";

const domBoard = document.getElementById('chessboard');
const state = {
    canPlayBack: false,
    canPlayForward: true,
};

const pieceStack = [];
const movesStack = [];

// Webkit
let _sendMessage = (key, value) => {
    console.log(key, value);
};

if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jsHandler){
    _sendMessage = (key, value) => {
        if (value === undefined) value = "";
        window.webkit.messageHandlers.jsHandler.postMessage(`${key}=${value}`);
    }
}

window._handleMessage = (key, value) => {
    if (key === "dispatchEvent") document.dispatchEvent(new Event(value));
};

const broadcastState = () => {
    const keys = ['canPlayBack', 'canPlayForward'];
    for (let k of keys){
        if (typeof state[k] === 'object') _sendMessage(`${k}`, `${JSON.stringify(state[k])}`);
        else _sendMessage(`${k}`, `${state[k]}`);
    }
}

let lastSize = {
    w: null,
    h: null
};
const updateSize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (lastSize.w === w && lastSize.h === h) return;

    const size = Math.min(w, h) + 1;

    domBoard.style.width = size + 'px';
    domBoard.style.height = size + 'px';

    if (w > h){
        domBoard.style.marginLeft = (w - h) / 2 + 'px';
        domBoard.style.marginTop = '0px';
    }else{
        domBoard.style.marginLeft = '0px';
        domBoard.style.marginTop = (h - w) / 2 + 'px';
    }

    lastSize.w = w;
    lastSize.h = h;
}

// Chess engine
const game = new Chess();
const calcDests = () => {
    const dests = new Map();
    
    // All legal moves allowed
    game.SQUARES.forEach(s => {
        const ms = game.moves({square: s, verbose: true});
        if (ms.length) dests.set(s, ms.map(m => m.to));
    });

    return dests;
}


const uciToMove = (uci) => {
    let result = ["", ""];
    let c = 0;

    for (let i = 0; i < uci.length; ){
        if (/[a-h]/.test(uci[i])){
            result[c] += uci[i++];
            result[c++] += uci[i++];
        }else{
            i++; // Promotion character?
        }
        if (c > 1) break;
    }
    return result;
};


const updateCg = () => {
    cg.set({
        orientation: color,
        highlight: {
            lastMove: true
        },

        turnColor:  game.turn() === 'w' ? 'white' : 'black',
        
        // this highlights the checked king in red
        check: game.in_check(),
        
        movable: {
            // Only allow moves by whoevers turn it is
            color: game.turn() === 'w' ? 'white' : 'black',
            
            // Only allow legal moves
            dests: calcDests()
        }
    });
}

const handleBoardClick = (e) => {
    if (state.showingShapes){
        const { left, top, width } = domBoard.getBoundingClientRect();
        const x = e.clientX - left;
        const y = e.clientY - top;
        
        const squareSize = width / 8;
        const idx = Math.floor(x / squareSize);
        const idy = Math.floor(y / squareSize);

        let clickedSquare = color === "white" ? game.SQUARES[idy * 8 + idx] : game.SQUARES[(7 - idy) * 8 + (7 - idx)];
        if (!clickedSquare) return;
    }
};

const afterPlayerMove = (orig, dest) => {
    const playerMove = `${orig}${dest}`;
    
    const correctMove = moves[movesStack.length - 1];
    if (!correctMove){
        confettiToss();
        return;
    }
    const shapes = [];

    if (playerMove === `${correctMove['from']}${correctMove['to']}`){
        shapes.push({
            orig,
            dest,
            brush: 'green'
        });

        // Play opponent's next move
        if (!playForward()){
            confettiToss();
        }else if (moves.length === movesStack.length){
            confettiToss();
        }
    }else{
        shapes.push({
            orig,
            dest,
            brush: 'red'
        });
        shapes.push({
            orig: correctMove['from'],
            dest: correctMove['to'],
            brush: 'green'
        });

        playBack();
    }

    const nextCorrectMove = moves[movesStack.length];
    if (nextCorrectMove){
        shapes.push({
            orig: nextCorrectMove['from'],
            brush: 'green'
        });
    }

    cg.setAutoShapes(shapes);
};

const getPromotion = () => {
    const currentMove = moves[game.history().length];
    return currentMove?.promotion;
}

const checkPlayerMove = (orig, dest) => {
    touchMoved = true;
    
    pieceStack.push(checkMoveResult(game.move({from: orig, to: dest, promotion: getPromotion()})));
    updateCg();
    movesStack.push([orig, dest]);

    afterPlayerMove(orig, dest);
};

const chessTypeToCgRole = {
    "p": "pawn",
    "r": "rook",
    "n": "knight",
    "b": "bishop",
    "q": "queen",
    "k": "king",
};

const chessMoveToCgPiece = (move) => {
    const { captured, color, promotion } = move;

    let pColor = color === "w" ? "black" : "white";
    let pRole = chessTypeToCgRole[captured];

    if (promotion){
        // "Capture" your own color
        pColor = color === "w" ? "white" : "black";
        pRole = "pawn";
    }

    return {
        role: pRole, 
        color: pColor
    };
}

const checkUndoCastle = (move) => {
    if (!move) return;

    const { flags, from } = move;
    const kingCastle = flags.indexOf("k") !== -1;
    const queenCastle = flags.indexOf("q") !== -1;
    
    if (kingCastle || queenCastle){
        if (from === "e1"){
            if (kingCastle) cg.move("f1", "h1");
            else cg.move("d1", "a1");
        }else if (from === "e8"){
            if (kingCastle) cg.move("f8", "h8");
            else cg.move("d8", "a8");
        }else{
            throw new Error(`Unexpected castle from ${from}`);
        }
    }
}

const checkMoveResult = (move) => {
    if (!move) return;

    const { flags, to, promotion, color } = move;
    const enPassant = flags.indexOf("e") !== -1;
    const stdCapture = flags.indexOf("c") !== -1;
    const noCapture = flags.indexOf("n") !== -1;

    if (noCapture && !promotion) return;

    if (enPassant || stdCapture || promotion){
        const p = chessMoveToCgPiece(move);
        if (stdCapture) p.position = to;
        else if (promotion){
            p.position = to;
            p.promotion = true;
            cg.setPieces([[p.position, {
                role: chessTypeToCgRole[promotion],
                color: color === "w" ? "white" : "black"
            }]]);
        }else if (enPassant){
            if (move.color === "w"){
                p.position = to[0] + parseInt(to[1] - 1)
            }else{
                p.position = to[0] + parseInt(to[1] + 1);
            }
            cg.setPieces([[p.position, null]]); // Remove piece
        }else return; // Should never happen
        
        return p;
    }
}

const playMove = (orig, dest, undo = false) => {
    cg.move(orig, dest);

    if (undo){
        checkUndoCastle(game.undo());

        let piece = pieceStack.pop();
        if (piece){
            if (piece.promotion){
                // Undo promotion
                cg.setPieces([[dest, {
                    role: "pawn",
                    color: piece.color
                }]]);
            }else{
                cg.newPiece(piece, piece.position);
            }
        }
    }else{
        const move = game.move({from: orig, to: dest, promotion: getPromotion()});
        pieceStack.push(checkMoveResult(move));
        movesStack.push([orig, dest]);
    }

    updateCg();
};

// Board
const cg = Chessground(domBoard, {
    orientation: "white",
    movable: {
        color: "white",
        free: false, // don't allow movement anywhere ...
        dests: calcDests(),
        events: {
            after: checkPlayerMove
        }
    }
});

// Setup colors
const Colors = {
    green: '#009d07',
    pink: '#b700af',
    blue: '#0057E9',
    orange: '#ff8d00',
    grey: '#4a4a4a',
    red: '#b70000',
    white: "#898989"
};
let cgBrushes = {};
for (let k in Colors){
    cgBrushes[k] = {key: k, color: Colors[k], opacity: 1, lineWidth: 10};
}
cg.set({drawable: { brushes: cgBrushes}});


let moves = [];

const updateState = () => {
    state.canPlayBack = movesStack.length > 0;
    state.canPlayForward = movesStack.length < moves.length;

    broadcastState();
}

const playForward = () => {
    if (movesStack.length >= moves.length) return false;
    
    const { from, to } = moves[movesStack.length];
    playMove(from, to);
    updateState();

    return true;
};

const manualPlayForward = () => {
    playForward();
    if ((game.turn() === "b" && color === "white") || (game.turn() === "w" && color === "black")){
        playForward();
    }
    cg.setAutoShapes([]);
}

const playBack = () => {
    if (movesStack.length <= 0) return;
    if (movesStack.length <= 1 && color === "black") return;

    const [dest, orig] = movesStack.pop();
    playMove(orig, dest, true);

    updateState();
}

const manualPlayBack = () => {
    playBack();
    if ((game.turn() === "b" && color === "white") || (game.turn() === "w" && color === "black")){
        playBack();
    }
    cg.setAutoShapes([]);
}

const rewind = () => {
    let move;
    while (move = movesStack.pop()){
        const [dest, orig] = move;
        playMove(orig, dest, true);
    }


    updateState();
    cg.setAutoShapes([]);

    cg.set({
        highlight: {
            lastMove: false
        }
    });
}



const confettiToss = () => {
    confetti({
        particleCount: 100,
        spread: 60,
        ticks: 100,
        origin: { y: 0.7 }
    });
}


const flash = (text) => {
    const el = document.createElement("div");
    el.classList.add("flash");
    el.innerHTML = `<div class="text">${text}</div>`;
    document.body.append(el);
    setTimeout(() => {
        el.remove();
    }, 2000);
}



let touchMoved = false;

if (('ontouchstart' in window) ||
       (navigator.maxTouchPoints > 0) ||
       (navigator.msMaxTouchPoints > 0)){
    window.addEventListener('touchstart', e => {
        setTimeout(() => {
            if (e.touches && !touchMoved){
                handleBoardClick({
                    clientX: e.touches[0].clientX,
                    clientY: e.touches[0].clientY
                });
            }

            touchMoved = false;
        }, 0);
    });
}else{
    window.addEventListener('click', handleBoardClick);
}

const loadPgn = (username, cb) => {
    fetch(`/gen/${username}.pgn.txt`)
        .then(response => response.text())
        .then((pgn) => {
            const pgnGames = pgn.trim().split("\n\n\n");
            
            let pgnGame = pgnGames[7];

            const g = new Chess();
            if (!g.load_pgn(pgnGame)) throw new Error(`Invalid PGN: ${pgnGames}`);
            
            const moves = g.history({verbose: true});

            // Parse color
            window.pgnGame = pgnGame;
            
            let color = "white"; 
            for (let line of pgnGame.split("\n")){
                if (line.toLowerCase().trim() === `[Black "${username}"]`.toLowerCase().trim()){
                    color = "black";
                    break;
                }
            }
            
            let winner = "draw";
            if (pgnGame.slice(pgnGame.length - "1-0".length, pgnGame.length) === "1-0"){
                winner = "white";
            }else if (pgnGame.slice(pgnGame.length - "0-1".length, pgnGame.length) === "0-1"){
                winner = "black";
            }

            cb(moves, color, winner);
        });
};

const startGame = (username) => {
    loadPgn(username, (loadedMoves, playerColor, winner) => {
        moves = loadedMoves;
        color = playerColor;
        // console.log("Outcome: " + winner);
        updateCg();

        if (color === "black") playForward();

        // for (let i = 0; i < 100; i++) playForward();

        const nextCorrectMove = moves[movesStack.length];
        if (nextCorrectMove){
            cg.setAutoShapes([{
                orig: nextCorrectMove['from'],
                brush: 'green'
            }]);
        }
    });
};

const togglePawns = () => {
    // if (document.body.classList.contains("hide-pawns")){
    //     document.body.classList.remove("hide-pawns");
    // }else{
    //     document.body.classList.add("hide-pawns");
    // }
    document.body.classList.toggle("hide-pawns");
};
const togglePieces = () => {
    document.body.classList.toggle("hide-pieces");
};

updateSize();
window.addEventListener('resize', updateSize);
setInterval(updateSize, 200);

document.addEventListener('playForward', manualPlayForward);
document.addEventListener('playBack', manualPlayBack);
document.addEventListener('rewind', rewind);
document.addEventListener('togglePawns', togglePawns);
document.addEventListener('togglePieces', togglePieces);

window.addEventListener('keydown', (e) => {
    if (e.keyCode === 37){
        manualPlayBack();
    }else if (e.keyCode === 39){
        manualPlayForward();
    }
});

// Debug
if (/192\.168\.\d+\.\d+/.test(window.location.hostname) ||
    /localhost/.test(window.location.hostname)){
    const debug = document.getElementById("debug");
    debug.style.display = 'block';

    window.cg = cg;
    window.game = game;
    window.domBoard = domBoard;
    window.movesStack = movesStack;
}

// ==== END INIT ====

startGame(username);

}
