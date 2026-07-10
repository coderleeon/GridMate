import {
    cloneBoard,
    findEmpty,
    isValid,
    isBoardValid,
    getBoardConflicts,
    solve,
    getLogicalHint,
    estimateDifficulty,
    getCandidates
} from './solver.js';

// Pre-defined puzzles (81-character strings, 0 represents empty)
const PUZZLES = {
    easy: "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
    medium: "000260701680070090190004500820100040004602900050003028009300074040050036703018000",
    hard: "000600400700003600000091080000000000050180003000306045040200060903000000020000100",
    expert: "100007090030020008009600500005300900010080002600040007097058000000060020040000006"
};

// Application State
let board = Array(9).fill().map(() => Array(9).fill(0));
let initialBoard = Array(9).fill().map(() => Array(9).fill(0));
let preSolveBoard = Array(9).fill().map(() => Array(9).fill(0));
let givens = Array(9).fill().map(() => Array(9).fill(false)); // Pre-populated template nodes
let history = [];
let historyIndex = -1;
let activeCell = null; // {row, col}
let autoNotesActive = false;

// OCR Image Transformation State
let ocrImage = null;
let ocrZoom = 1.0;
let ocrPanX = 0;
let ocrPanY = 0;
let ocrRotation = 0;

// DOM Elements
const gridElement = document.getElementById('sudoku-grid');
const notesToggleBtn = document.getElementById('notes-toggle-btn');
const statusPill = document.getElementById('status-pill');
const difficultyPill = document.getElementById('difficulty-pill');
const explanationBody = document.getElementById('explanation-body');

// Stats DOM
const statTime = document.getElementById('stat-time');
const statCalls = document.getElementById('stat-calls');
const statFilled = document.getElementById('stat-filled');
const statEmpty = document.getElementById('stat-empty');

// Modals
const modalImport = document.getElementById('modal-import');
const modalExport = document.getElementById('modal-export');
const modalOcrAlign = document.getElementById('modal-ocr-align');
const importInput = document.getElementById('import-input');
const exportOutput = document.getElementById('export-output');
const ocrStatusLog = document.getElementById('ocr-status-log');

// Canvas Elements for OCR
const ocrCanvas = document.getElementById('ocr-canvas');
const ocrCtx = ocrCanvas.getContext('2d');

window.addEventListener('DOMContentLoaded', () => {
    initGrid();
    setupKeypad();
    setupActionBar();
    setupSecondaryActions();
    setupModals();
    setupKeyboardShortcuts();
    setupOcrUploader();
    saveState();
    updateStats();
    
    // Service worker registration
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
});

// Dynamic grid generation (Flat cells, no inputs to completely block native keyboards)
function initGrid() {
    gridElement.innerHTML = '';
    
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = r;
            cell.dataset.col = c;
            
            // Appending 3x3 markers
            if (c === 2 || c === 5) cell.classList.add('border-right-thick');
            if (r === 2 || r === 5) cell.classList.add('border-bottom-thick');
            
            // Subgrid candidate notes
            const notesGrid = document.createElement('div');
            notesGrid.classList.add('notes-grid');
            for (let i = 1; i <= 9; i++) {
                const noteNum = document.createElement('span');
                noteNum.classList.add('note-num');
                noteNum.dataset.note = i;
                noteNum.innerText = i;
                notesGrid.appendChild(noteNum);
            }
            cell.appendChild(notesGrid);

            // Selection interaction handler (Works with both mouse clicks and touch taps)
            cell.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                setActiveCell(r, c);
            });
            
            gridElement.appendChild(cell);
        }
    }
}

// Visual cell selection borders
function setActiveCell(row, col) {
    if (activeCell && activeCell.row === row && activeCell.col === col) return;
    
    activeCell = { row, col };
    
    const cells = gridElement.querySelectorAll('.cell');
    cells.forEach(cell => {
        const r = parseInt(cell.dataset.row);
        const c = parseInt(cell.dataset.col);
        
        cell.classList.remove('active', 'highlight-line');
        
        if (r === row && c === col) {
            cell.classList.add('active');
        } else if (r === row || c === col) {
            cell.classList.add('highlight-line');
        }
    });
}

function clearActiveCell() {
    activeCell = null;
    const cells = gridElement.querySelectorAll('.cell');
    cells.forEach(cell => cell.classList.remove('active', 'highlight-line'));
}

// Binds custom on-screen virtual keypad actions
function setupKeypad() {
    const keypadPanel = document.querySelector('.keypad-grid');
    const keys = keypadPanel.querySelectorAll('.key-btn');
    
    keys.forEach(key => {
        key.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!activeCell) return;
            
            const val = key.dataset.val;
            const { row, col } = activeCell;
            
            if (givens[row][col]) return;
            
            if (val === 'clear') {
                updateCellValue(row, col, 0, true);
            } else if (val) {
                updateCellValue(row, col, parseInt(val), true);
            }
        });
    });

    notesToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        autoNotesActive = !autoNotesActive;
        notesToggleBtn.classList.toggle('active-mode', autoNotesActive);
        renderNotes();
    });
}

// Centralized Cell Updates & Rendering
function updateCellValue(row, col, val, isInteractive = false) {
    board[row][col] = val;
    
    const cell = gridElement.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    cell.classList.remove('conflict', 'hint-pulse');
    
    const textNode = Array.from(cell.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    if (val !== 0) {
        if (textNode) {
            textNode.nodeValue = val;
        } else {
            cell.appendChild(document.createTextNode(val));
        }
        cell.classList.add('inserted');
        setTimeout(() => cell.classList.remove('inserted'), 250);
    } else {
        if (textNode) {
            cell.removeChild(textNode);
        }
    }
    
    renderNotes();
    saveState();
    updateStats();
    
    if (isInteractive) {
        // Clear conflicting red overlays on user edits
        gridElement.querySelectorAll('.cell').forEach(c => c.classList.remove('conflict'));
        
        // Auto-advance selection
        if (val >= 1 && val <= 9) {
            let nextCol = col + 1;
            let nextRow = row;
            if (nextCol > 8) {
                nextCol = 0;
                nextRow = row + 1;
            }
            if (nextRow < 9) {
                setActiveCell(nextRow, nextCol);
            }
        }
    }
    
    updateStatusPill();
}

// Renders 3x3 candidate auto-notes
function renderNotes() {
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const cell = gridElement.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
            const notesGrid = cell.querySelector('.notes-grid');
            
            if (board[r][c] !== 0 || !autoNotesActive) {
                notesGrid.style.display = 'none';
                continue;
            }
            
            notesGrid.style.display = 'grid';
            const candidates = getCandidates(board, r, c);
            
            for (let i = 1; i <= 9; i++) {
                const noteNum = notesGrid.querySelector(`.note-num[data-note="${i}"]`);
                if (candidates.includes(i)) {
                    noteNum.classList.add('visible');
                } else {
                    noteNum.classList.remove('visible');
                }
            }
        }
    }
}

// Status indicator updater
function updateStatusPill() {
    const conflicts = getBoardConflicts(board);
    
    if (conflicts.length > 0) {
        statusPill.innerText = "Invalid";
        statusPill.className = "status-pill invalid";
    } else {
        let isFilled = true;
        for (let r = 0; r < 9; r++) {
            if (board[r].includes(0)) {
                isFilled = false;
                break;
            }
        }
        
        if (isFilled) {
            statusPill.innerText = "Solved";
            statusPill.className = "status-pill valid";
        } else {
            statusPill.innerText = "Valid";
            statusPill.className = "status-pill valid";
        }
    }
}

// Highlights conflicts on Solve / Validate requests
function showValidationConflicts() {
    const conflicts = getBoardConflicts(board);
    gridElement.querySelectorAll('.cell').forEach(c => c.classList.remove('conflict'));
    
    if (conflicts.length > 0) {
        conflicts.forEach(coord => {
            const cell = gridElement.querySelector(`.cell[data-row="${coord.row}"][data-col="${coord.col}"]`);
            if (cell) cell.classList.add('conflict');
        });
        statusPill.innerText = "Invalid";
        statusPill.className = "status-pill invalid";
        return true;
    }
    return false;
}

// Expose Primary Action Event Listeners
function setupActionBar() {
    // Validate Click
    document.getElementById('btn-validate').addEventListener('click', () => {
        const hasConflicts = showValidationConflicts();
        if (hasConflicts) {
            explanationBody.innerHTML = `
                <div style="color: var(--accent-error); font-weight:600;">Validation Failed!</div>
                The board contains duplicate numbers in overlapping rows, columns, or 3x3 box regions. Conflicting cells are highlighted in red.
            `;
        } else {
            const testResult = solve(board);
            if (testResult.solved) {
                explanationBody.innerHTML = `
                    <div style="color: var(--accent-success); font-weight:600;">Board is Valid and Solvable!</div>
                    No conflicts found. Try requesting a logical Hint or click Solve to complete the puzzle.
                `;
            } else {
                statusPill.innerText = "Impossible";
                statusPill.className = "status-pill invalid";
                explanationBody.innerHTML = `
                    <div style="color: var(--accent-error); font-weight:600;">Impossible Puzzle!</div>
                    Although there are no immediate duplicates, this configuration cannot be solved under Sudoku rules.
                `;
            }
        }
        document.getElementById('card-explanation').classList.add('open');
    });

    // Hint Click
    document.getElementById('btn-hint').addEventListener('click', () => {
        gridElement.querySelectorAll('.cell').forEach(c => c.classList.remove('hint-pulse'));
        
        const hint = getLogicalHint(board);
        if (hint) {
            const cell = gridElement.querySelector(`.cell[data-row="${hint.row}"][data-col="${hint.col}"]`);
            if (cell) {
                cell.classList.add('hint-pulse');
                setActiveCell(hint.row, hint.col);
            }
            explanationBody.innerHTML = `
                <div style="font-weight:700; color: var(--accent-success); margin-bottom:4px;">Hint: ${hint.type}</div>
                <div class="explanation-text">${hint.reason}</div>
                <div class="reason-highlight">${hint.details.replace(/\n/g, '<br>')}</div>
            `;
        } else {
            explanationBody.innerText = "No logical hint found. Advanced solving (backtracking solver) required.";
        }
        document.getElementById('card-explanation').classList.add('open');
    });

    // Next Move Click
    document.getElementById('btn-next-move').addEventListener('click', () => {
        const hint = getLogicalHint(board);
        if (hint) {
            updateCellValue(hint.row, hint.col, hint.value, true);
            const cell = gridElement.querySelector(`.cell[data-row="${hint.row}"][data-col="${hint.col}"]`);
            cell.classList.add('hint-pulse');
            setTimeout(() => cell.classList.remove('hint-pulse'), 1500);
            explanationBody.innerHTML = `
                <div style="font-weight: 600; color: var(--accent-success);">Logical Move Placed!</div>
                Filled cell at Row ${hint.row + 1}, Col ${hint.col + 1} with ${hint.value} (${hint.type}).
            `;
        } else {
            const result = solve(board);
            if (result.solved) {
                let filled = false;
                for (let r = 0; r < 9; r++) {
                    for (let c = 0; c < 9; c++) {
                        if (board[r][c] === 0 && result.board[r][c] !== 0) {
                            updateCellValue(r, c, result.board[r][c], true);
                            const cell = gridElement.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
                            cell.classList.add('hint-pulse');
                            setTimeout(() => cell.classList.remove('hint-pulse'), 1500);
                            filled = true;
                            explanationBody.innerHTML = `
                                <div style="font-weight: 600; color: var(--accent-success);">Move Placed (Backtracking Step)</div>
                                Filled Row ${r + 1}, Col ${c + 1} with ${result.board[r][c]} using algorithmic backtracking.
                            `;
                            break;
                        }
                    }
                    if (filled) break;
                }
            } else {
                explanationBody.innerText = "Cannot place next move. The puzzle is invalid or impossible.";
            }
        }
        document.getElementById('card-explanation').classList.add('open');
    });

    // Solve Click
    document.getElementById('btn-solve').addEventListener('click', () => {
        const hasConflicts = showValidationConflicts();
        if (hasConflicts) {
            explanationBody.innerHTML = `
                <div style="color: var(--accent-error); font-weight:600;">Solve Failed!</div>
                The grid contains duplicate numbers in rows, columns, or 3x3 subgrids. Conflicting cells are highlighted in red.
            `;
            document.getElementById('card-explanation').classList.add('open');
            return;
        }

        preSolveBoard = cloneBoard(board);
        
        const startTime = performance.now();
        const result = solve(board);
        const endTime = performance.now();
        const elapsed = (endTime - startTime).toFixed(2);
        
        if (result.solved) {
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (board[r][c] === 0) {
                        board[r][c] = result.board[r][c];
                        const cell = gridElement.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
                        
                        const textNode = Array.from(cell.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
                        if (textNode) {
                            textNode.nodeValue = result.board[r][c];
                        } else {
                            cell.appendChild(document.createTextNode(result.board[r][c]));
                        }
                        
                        cell.classList.add('inserted');
                        setTimeout(() => cell.classList.remove('inserted'), 250);
                    }
                }
            }
            
            renderNotes();
            saveState();
            
            statTime.innerText = `${elapsed} ms`;
            statCalls.innerText = result.steps;
            updateStats();
            updateStatusPill();
            
            const diff = estimateDifficulty(preSolveBoard, result.steps);
            difficultyPill.innerText = diff;
            
            explanationBody.innerHTML = `
                <div style="color: var(--accent-success); font-weight:700;">Puzzle Solved!</div>
                Solver completed in <strong>${elapsed} ms</strong> with <strong>${result.steps} backtracking steps</strong>.<br>
                Assessed difficulty: <strong>${diff}</strong>.
            `;
            
            document.getElementById('card-stats').classList.add('open');
            document.getElementById('card-explanation').classList.add('open');
        } else {
            explanationBody.innerHTML = `<span style="color: var(--accent-error);">Solver failed. Grid has duplicate entries or is impossible to solve.</span>`;
            document.getElementById('card-explanation').classList.add('open');
        }
    });
}

// Binds secondary operations (Reset, Clear, Example select, Undo, Redo)
function setupSecondaryActions() {
    // Reset Click
    document.getElementById('btn-reset').addEventListener('click', () => {
        board = cloneBoard(preSolveBoard);
        syncBoardToDOM();
        saveState();
        updateStats();
        updateStatusPill();
        explanationBody.innerText = "Board restored to pre-solve state.";
    });

    // Clear Click
    document.getElementById('btn-clear').addEventListener('click', () => {
        board = Array(9).fill().map(() => Array(9).fill(0));
        initialBoard = Array(9).fill().map(() => Array(9).fill(0));
        preSolveBoard = Array(9).fill().map(() => Array(9).fill(0));
        givens = Array(9).fill().map(() => Array(9).fill(false));
        
        syncBoardToDOM();
        clearActiveCell();
        saveState();
        updateStats();
        updateStatusPill();
        
        difficultyPill.innerText = "N/A";
        statusPill.innerText = "Empty";
        statusPill.className = "status-pill";
        explanationBody.innerText = "Board cleared. Tap cells or upload a screenshot to start.";
    });

    // Example dropdown select
    const selector = document.getElementById('select-puzzle');
    selector.addEventListener('change', (e) => {
        const mode = e.target.value;
        if (mode && PUZZLES[mode]) {
            loadBoardString(PUZZLES[mode]);
            selector.value = ""; // Reset selector focus
        }
    });

    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
}

// Undo/Redo State stack
function saveState() {
    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }
    history.push({
        board: cloneBoard(board),
        givens: givens.map(row => [...row])
    });
    historyIndex++;
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        const state = history[historyIndex];
        board = cloneBoard(state.board);
        givens = state.givens.map(row => [...row]);
        
        syncBoardToDOM();
        updateStats();
        updateStatusPill();
        explanationBody.innerText = "Action Undone.";
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        const state = history[historyIndex];
        board = cloneBoard(state.board);
        givens = state.givens.map(row => [...row]);
        
        syncBoardToDOM();
        updateStats();
        updateStatusPill();
        explanationBody.innerText = "Action Redone.";
    }
}

function syncBoardToDOM() {
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const cell = gridElement.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
            cell.classList.remove('given', 'conflict', 'hint-pulse');
            
            if (givens[r][c]) {
                cell.classList.add('given');
            }
            
            const val = board[r][c];
            const textNode = Array.from(cell.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
            if (val !== 0) {
                if (textNode) {
                    textNode.nodeValue = val;
                } else {
                    cell.appendChild(document.createTextNode(val));
                }
            } else {
                if (textNode) {
                    cell.removeChild(textNode);
                }
            }
        }
    }
    renderNotes();
}

function loadBoardString(sudokuStr) {
    if (sudokuStr.length !== 81) return;
    
    board = Array(9).fill().map(() => Array(9).fill(0));
    givens = Array(9).fill().map(() => Array(9).fill(false));
    
    for (let i = 0; i < 81; i++) {
        const char = sudokuStr[i];
        const val = parseInt(char);
        const r = Math.floor(i / 9);
        const c = i % 9;
        
        if (val >= 1 && val <= 9) {
            board[r][c] = val;
            givens[r][c] = true;
        }
    }
    
    preSolveBoard = cloneBoard(board);
    initialBoard = cloneBoard(board);
    
    syncBoardToDOM();
    clearActiveCell();
    
    history = [];
    historyIndex = -1;
    saveState();
    
    updateStats();
    updateStatusPill();
    
    difficultyPill.innerText = estimateDifficulty(board, 0);
    explanationBody.innerText = "Puzzle template loaded successfully.";
}

function updateStats() {
    let filledCount = 0;
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (board[r][c] !== 0) filledCount++;
        }
    }
    statFilled.innerText = `${filledCount} / 81`;
    statEmpty.innerText = `${81 - filledCount}`;
}

// Setup Import/Export Dialog Modal handlers
function setupModals() {
    // Import Modal Trigger
    document.getElementById('btn-import-prompt').addEventListener('click', () => {
        modalImport.classList.add('active');
        importInput.value = "";
        importInput.focus();
    });

    document.getElementById('btn-import-confirm').addEventListener('click', () => {
        const code = importInput.value.trim().replace(/\./g, '0');
        if (code.length === 81 && /^[0-9]+$/.test(code)) {
            loadBoardString(code);
            closeModal('modal-import');
        } else {
            alert("Error: Sudoku code must be exactly 81 characters containing digits 0-9.");
        }
    });

    // Export Modal Trigger
    document.getElementById('btn-export-prompt').addEventListener('click', () => {
        modalExport.classList.add('active');
        
        let str = "";
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                str += board[r][c] === 0 ? "0" : board[r][c].toString();
            }
        }
        exportOutput.value = str;
        exportOutput.select();
    });

    document.getElementById('btn-export-copy').addEventListener('click', () => {
        exportOutput.select();
        navigator.clipboard.writeText(exportOutput.value).then(() => {
            alert("Board code copied to clipboard!");
            closeModal('modal-export');
        });
    });
}

window.closeModal = function(modalId) {
    document.getElementById(modalId).classList.remove('active');
};

// Desktop Keyboard Navigation & Input listeners
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Stop listener inside input text fields (modals)
        if (document.activeElement.tagName === 'INPUT') {
            return;
        }

        // Ctrl+Z Undo
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
            return;
        }
        
        // Ctrl+Y Redo
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redo();
            return;
        }

        if (!activeCell) return;
        const { row, col } = activeCell;

        if (e.key >= '1' && e.key <= '9') {
            if (!givens[row][col]) {
                updateCellValue(row, col, parseInt(e.key), true);
            }
            e.preventDefault();
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            
            // Intelligent backspace behavior:
            if (board[row][col] !== 0) {
                // If cell has value: Clear the value, keep active focus on cell
                if (!givens[row][col]) {
                    updateCellValue(row, col, 0, true);
                }
            } else {
                // If cell is already empty: Shift selection left and clear previous cell
                let prevCol = col - 1;
                let prevRow = row;
                if (prevCol < 0) {
                    prevCol = 8;
                    prevRow = row - 1;
                }
                
                if (prevRow >= 0) {
                    setActiveCell(prevRow, prevCol);
                    if (!givens[prevRow][prevCol]) {
                        updateCellValue(prevRow, prevCol, 0, true);
                    }
                }
            }
        } else if (e.key === 'ArrowUp') {
            const nextRow = (row - 1 + 9) % 9;
            setActiveCell(nextRow, col);
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            const nextRow = (row + 1) % 9;
            setActiveCell(nextRow, col);
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            const nextCol = (col - 1 + 9) % 9;
            setActiveCell(row, nextCol);
            e.preventDefault();
        } else if (e.key === 'ArrowRight') {
            const nextCol = (col + 1) % 9;
            setActiveCell(row, nextCol);
            e.preventDefault();
        } else if (e.key === 'Escape') {
            clearActiveCell();
            e.preventDefault();
        }
    });
}

// -------------------------------------------------------------
// Interactive Canvas-Based OCR Alignment & Tesseract Parsing
// -------------------------------------------------------------
function setupOcrUploader() {
    const fileInput = document.getElementById('ocr-file-input');
    
    // Listen for image upload
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                ocrImage = new Image();
                ocrImage.onload = () => {
                    // Reset alignments
                    ocrZoom = 1.0;
                    ocrPanX = 0;
                    ocrPanY = 0;
                    ocrRotation = 0;
                    
                    // Show Alignment Editor Modal
                    modalOcrAlign.classList.add('active');
                    drawOcrCanvas();
                };
                ocrImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
        // Reset fileInput so same file can be uploaded again
        fileInput.value = "";
    });

    // Alignment Canvas button event listeners
    document.getElementById('btn-ocr-pan-up').addEventListener('click', () => { ocrPanY -= 6; drawOcrCanvas(); });
    document.getElementById('btn-ocr-pan-down').addEventListener('click', () => { ocrPanY += 6; drawOcrCanvas(); });
    document.getElementById('btn-ocr-pan-left').addEventListener('click', () => { ocrPanX -= 6; drawOcrCanvas(); });
    document.getElementById('btn-ocr-pan-right').addEventListener('click', () => { ocrPanX += 6; drawOcrCanvas(); });
    
    document.getElementById('btn-ocr-zoom-in').addEventListener('click', () => { ocrZoom += 0.05; drawOcrCanvas(); });
    document.getElementById('btn-ocr-zoom-out').addEventListener('click', () => { ocrZoom = Math.max(0.1, ocrZoom - 0.05); drawOcrCanvas(); });
    
    document.getElementById('btn-ocr-rotate-l').addEventListener('click', () => { ocrRotation -= 1; drawOcrCanvas(); });
    document.getElementById('btn-ocr-rotate-r').addEventListener('click', () => { ocrRotation += 1; drawOcrCanvas(); });

    // Cancel Alignment Modal
    document.getElementById('btn-ocr-cancel').addEventListener('click', () => {
        modalOcrAlign.classList.remove('active');
        ocrImage = null;
    });

    // Run Tesseract OCR Process
    document.getElementById('btn-ocr-process').addEventListener('click', async () => {
        if (!ocrImage) return;
        
        // Prevent clicking during processing
        document.getElementById('btn-ocr-process').disabled = true;
        document.getElementById('btn-ocr-cancel').disabled = true;
        ocrStatusLog.innerText = "Initializing Tesseract engine...";
        
        try {
            // Check if online or if Tesseract is loaded
            if (typeof Tesseract === 'undefined') {
                throw new Error("Tesseract.js script could not be loaded. Please check your internet connection.");
            }

            // Create canvas crops for the 81 Sudoku cells
            const cellCanvases = sliceAlignedGrid();
            
            // Build the board parsing buffers
            const parsedBoard = Array(9).fill().map(() => Array(9).fill(0));
            
            // Filter cells to run OCR on (only processes cells with actual text)
            const activeCells = [];
            for (let i = 0; i < 81; i++) {
                const r = Math.floor(i / 9);
                const c = i % 9;
                const canvas = cellCanvases[i];
                
                if (cellHasDigit(canvas)) {
                    activeCells.push({ index: i, row: r, col: c, canvas: canvas });
                }
            }
            
            ocrStatusLog.innerText = `Analyzing digits (${activeCells.length} cells to scan)...`;
            
            // Initialize Tesseract Worker
            const worker = await Tesseract.createWorker({
                logger: m => {
                    if (m.status === 'recognizing text') {
                        ocrStatusLog.innerText = `Scanning: ${(m.progress * 100).toFixed(0)}%`;
                    }
                }
            });
            
            await worker.loadLanguage('eng');
            await worker.initialize('eng');
            // Restrict Tesseract parameters to digit whitelisting and single character mode (PSM 10)
            await worker.setParameters({
                tessedit_char_whitelist: '123456789',
                tessedit_pageseg_mode: '10'
            });

            // Perform OCR on active cells
            for (let i = 0; i < activeCells.length; i++) {
                const cell = activeCells[i];
                ocrStatusLog.innerText = `Processing cell ${i+1}/${activeCells.length}...`;
                
                const { data: { text } } = await worker.recognize(cell.canvas);
                const digit = parseInt(text.trim());
                if (digit >= 1 && digit <= 9) {
                    parsedBoard[cell.row][cell.col] = digit;
                }
            }
            
            await worker.terminate();
            
            // Populate the parsed board onto the screen grid
            board = cloneBoard(parsedBoard);
            givens = board.map(row => row.map(val => val !== 0));
            preSolveBoard = cloneBoard(board);
            initialBoard = cloneBoard(board);
            
            syncBoardToDOM();
            clearActiveCell();
            
            history = [];
            historyIndex = -1;
            saveState();
            updateStats();
            liveValidateOcr();
            
            ocrStatusLog.innerText = "Board parsed successfully!";
            setTimeout(() => {
                modalOcrAlign.classList.remove('active');
                document.getElementById('btn-ocr-process').disabled = false;
                document.getElementById('btn-ocr-cancel').disabled = false;
            }, 800);
            
        } catch (err) {
            console.error(err);
            ocrStatusLog.innerText = `OCR Error: ${err.message}`;
            document.getElementById('btn-ocr-process').disabled = false;
            document.getElementById('btn-ocr-cancel').disabled = false;
        }
    });
}

// Renders the uploaded image with Zoom/Pan/Rotation offsets inside canvas
function drawOcrCanvas() {
    if (!ocrImage) return;
    
    ocrCtx.clearRect(0, 0, ocrCanvas.width, ocrCanvas.height);
    ocrCtx.save();
    
    // Center of canvas
    const cx = ocrCanvas.width / 2;
    const cy = ocrCanvas.height / 2;
    
    // Apply panning translation
    ocrCtx.translate(cx + ocrPanX, cy + ocrPanY);
    
    // Apply scaling
    ocrCtx.scale(ocrZoom, ocrZoom);
    
    // Apply rotation (degrees to radians)
    ocrCtx.rotate((ocrRotation * Math.PI) / 180);
    
    // Draw the image centered relative to translation point
    const iw = ocrImage.width;
    const ih = ocrImage.height;
    const aspect = iw / ih;
    
    let dw, dh;
    if (aspect > 1) {
        dw = ocrCanvas.width;
        dh = dw / aspect;
    } else {
        dh = ocrCanvas.height;
        dw = dh * aspect;
    }
    
    ocrCtx.drawImage(ocrImage, -dw / 2, -dh / 2, dw, dh);
    ocrCtx.restore();
}

// Slice the 300x300 canvas grid into 81 sub-canvases
function sliceAlignedGrid() {
    const cells = [];
    const cellW = ocrCanvas.width / 9;
    const cellH = ocrCanvas.height / 9;
    
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const cellCanvas = document.createElement('canvas');
            cellCanvas.width = 40;
            cellCanvas.height = 40;
            const ctx = cellCanvas.getContext('2d');
            
            // Crop cell segment from aligned canvas
            ctx.drawImage(
                ocrCanvas,
                c * cellW, r * cellH, cellW, cellH, // source grid bounds
                0, 0, 40, 40 // destination dimensions
            );
            cells.push(cellCanvas);
        }
    }
    return cells;
}

// Analyzes pixel brightness variance in cell center to filter empty grid cells
function cellHasDigit(cellCanvas) {
    const ctx = cellCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, cellCanvas.width, cellCanvas.height);
    const pixels = imgData.data;
    
    let totalBrightness = 0;
    let count = 0;
    
    // Scan center 60% coordinates to block boundary line artifacts
    const borderX = Math.floor(cellCanvas.width * 0.2);
    const borderY = Math.floor(cellCanvas.height * 0.2);
    const endX = cellCanvas.width - borderX;
    const endY = cellCanvas.height - borderY;
    
    for (let y = borderY; y < endY; y++) {
        for (let x = borderX; x < endX; x++) {
            const idx = (y * cellCanvas.width + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx+1];
            const b = pixels[idx+2];
            // Standard relative luminance formula
            const brightness = 0.299*r + 0.587*g + 0.114*b;
            totalBrightness += brightness;
            count++;
        }
    }
    
    const avgBrightness = totalBrightness / count;
    
    // Calculate average absolute deviation
    let deviationSum = 0;
    for (let y = borderY; y < endY; y++) {
        for (let x = borderX; x < endX; x++) {
            const idx = (y * cellCanvas.width + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx+1];
            const b = pixels[idx+2];
            const brightness = 0.299*r + 0.587*g + 0.114*b;
            deviationSum += Math.abs(brightness - avgBrightness);
        }
    }
    
    const avgDeviation = deviationSum / count;
    
    // A cell with a digit will exhibit high brightness deviations (contrast)
    return avgDeviation > 12;
}

// Runs validation feedback specifically for newly scanned boards
function liveValidateOcr() {
    const conflicts = getBoardConflicts(board);
    gridElement.querySelectorAll('.cell').forEach(c => c.classList.remove('conflict'));
    
    if (conflicts.length > 0) {
        conflicts.forEach(coord => {
            const cell = gridElement.querySelector(`.cell[data-row="${coord.row}"][data-col="${coord.col}"]`);
            if (cell) cell.classList.add('conflict');
        });
        statusPill.innerText = "Invalid Scan";
        statusPill.className = "status-pill invalid";
        explanationBody.innerHTML = `
            <div style="color: var(--accent-error); font-weight:600;">Scan Conflicts Detected!</div>
            OCR finished, but the grid contains row, column, or box violations (highlighted in red). Correct them manually.
        `;
    } else {
        statusPill.innerText = "Valid Scan";
        statusPill.className = "status-pill valid";
        explanationBody.innerHTML = `
            <div style="color: var(--accent-success); font-weight:600;">OCR Complete and Validated!</div>
            Sudoku board scanned and verified with 0 conflicts. Ready to help or solve.
        `;
    }
    document.getElementById('card-explanation').classList.add('open');
}
