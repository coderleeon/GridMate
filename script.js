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
let givens = Array(9).fill().map(() => Array(9).fill(false)); // To prevent modifying loaded puzzle cells directly
let history = [];
let historyIndex = -1;
let activeCell = null; // {row, col}
let autoNotesActive = false;
let isSolvingAnimated = false;
let animationFrameId = null;

// DOM Elements
const gridElement = document.getElementById('sudoku-grid');
const keypadContainer = document.getElementById('keypad-container');
const notesToggleBtn = document.getElementById('notes-toggle-btn');
const statusPill = document.getElementById('status-pill');
const difficultyPill = document.getElementById('difficulty-pill');
const explanationBody = document.getElementById('explanation-body');

// Stats DOM
const statTime = document.getElementById('stat-time');
const statCalls = document.getElementById('stat-calls');
const statFilled = document.getElementById('stat-filled');
const statEmpty = document.getElementById('stat-empty');

// Bottom Sheet / Drawer
const bottomSheet = document.getElementById('bottom-sheet');
const sheetOverlay = document.getElementById('sheet-overlay');

// Modals
const modalImport = document.getElementById('modal-import');
const modalExport = document.getElementById('modal-export');
const importInput = document.getElementById('import-input');
const exportOutput = document.getElementById('export-output');

// Initial Setup on page load
window.addEventListener('DOMContentLoaded', () => {
    initGrid();
    setupKeypad();
    setupActionBar();
    setupBottomSheet();
    setupModals();
    setupKeyboardShortcuts();
    saveState();
    updateStats();
    
    // Register Service Worker placeholder for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {
            // Silently absorb if service worker file is not yet deployed
        });
    }
});

// Dynamic Grid Initialization
function initGrid() {
    gridElement.innerHTML = '';
    
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = r;
            cell.dataset.col = c;
            cell.tabIndex = 0; // Focusable via Tab navigation
            
            // Appending 3x3 grid markers
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

            // Hidden input to trigger native numeric pad on mobile tap
            const input = document.createElement('input');
            input.type = 'number';
            input.pattern = '[1-9]*';
            input.inputMode = 'numeric';
            input.classList.add('cell-input');
            cell.appendChild(input);

            // Event Listeners for Touch / Click Navigation
            setupCellInteractions(cell, r, c);
            
            gridElement.appendChild(cell);
        }
    }
}

// Touch & Pointer Gesture Handlers
function setupCellInteractions(cell, r, c) {
    let touchTimeout = null;
    let lastTap = 0;

    // Unified click / tap handler
    const selectHandler = (e) => {
        e.preventDefault();
        setActiveCell(r, c);
        
        // Focus the hidden input to trigger keyboard on mobile devices
        const input = cell.querySelector('.cell-input');
        if (input) {
            input.focus();
        }
    };

    cell.addEventListener('mousedown', selectHandler);
    
    // Double-tap to clear & Long-press to view candidates (optimized for mobile touch)
    cell.addEventListener('touchstart', (e) => {
        // Prevent trigger repetition
        if (e.cancelable) e.preventDefault();
        
        const currentTime = Date.now();
        const tapLength = currentTime - lastTap;
        
        if (tapLength < 250 && tapLength > 0) {
            // Double Tap: clear cell
            if (!givens[r][c]) {
                updateCellValue(r, c, 0);
            }
            clearTimeout(touchTimeout);
        } else {
            // Selection & potential Long Press
            setActiveCell(r, c);
            const input = cell.querySelector('.cell-input');
            if (input) input.focus();

            touchTimeout = setTimeout(() => {
                const candidates = getCandidates(board, r, c);
                explanationBody.innerHTML = `
                    <div class="reason-highlight">
                        <strong>Row ${r+1}, Column ${c+1} Candidates:</strong><br>
                        ${candidates.length > 0 ? candidates.join(', ') : 'No candidates fit this cell.'}
                    </div>
                `;
                // Open explanation card to ensure user sees it
                document.getElementById('card-explanation').classList.add('open');
            }, 600);
        }
        lastTap = currentTime;
    }, { passive: false });

    cell.addEventListener('touchend', () => {
        clearTimeout(touchTimeout);
    });

    cell.addEventListener('touchmove', () => {
        clearTimeout(touchTimeout);
    });

    // Handle hidden input keystrokes
    const input = cell.querySelector('.cell-input');
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
            e.stopPropagation(); // Stop event propagation to document
            if (!givens[r][c]) updateCellValue(r, c, 0, true);
            e.preventDefault();
        } else if (e.key >= '1' && e.key <= '9') {
            e.stopPropagation(); // Stop event propagation to document
            if (!givens[r][c]) updateCellValue(r, c, parseInt(e.key), true);
            e.preventDefault();
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Escape'].includes(e.key)) {
            // Let navigation bubble up to document keyboard listener
            return;
        } else {
            e.stopPropagation();
            e.preventDefault(); // block letters & special symbols
        }
    });
}

// Sets the currently active cell and highlights lines
function setActiveCell(row, col) {
    if (activeCell && activeCell.row === row && activeCell.col === col) return;
    
    activeCell = { row, col };
    
    // Toggle active and line highlighting classes
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

    // Make floating virtual keyboard visible
    keypadContainer.classList.add('visible');
}

function clearActiveCell() {
    activeCell = null;
    const cells = gridElement.querySelectorAll('.cell');
    cells.forEach(cell => cell.classList.remove('active', 'highlight-line'));
    keypadContainer.classList.remove('visible');
}

// Setup virtual custom floating keypad
function setupKeypad() {
    const keys = keypadContainer.querySelectorAll('.key-btn');
    keys.forEach(key => {
        key.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!activeCell) return;
            
            const val = key.dataset.val;
            const { row, col } = activeCell;
            
            if (givens[row][col]) return; // Cannot edit loaded templates
            
            if (val === 'clear') {
                updateCellValue(row, col, 0, true);
            } else if (val) {
                updateCellValue(row, col, parseInt(val), true);
            }
        });
    });

    // Notes toggle button click
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
    
    // Sync into DOM Cell
    const cell = gridElement.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    
    // Clear previous visual effects
    cell.classList.remove('conflict', 'hint-pulse');
    
    // Render value
    const textNode = Array.from(cell.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
    if (val !== 0) {
        if (textNode) {
            textNode.nodeValue = val;
        } else {
            cell.appendChild(document.createTextNode(val));
        }
        cell.classList.add('inserted');
        setTimeout(() => cell.classList.remove('inserted'), 300);
    } else {
        if (textNode) {
            cell.removeChild(textNode);
        }
    }
    
    renderNotes();
    saveState();
    updateStats();
    
    if (isInteractive) {
        // Clear any current red conflict highlights on user edit
        gridElement.querySelectorAll('.cell').forEach(c => c.classList.remove('conflict'));
        
        // Auto-advance to next cell
        if (val >= 1 && val <= 9) {
            let nextCol = col + 1;
            let nextRow = row;
            if (nextCol > 8) {
                nextCol = 0;
                nextRow = row + 1;
            }
            if (nextRow < 9) {
                setActiveCell(nextRow, nextCol);
                const nextCell = gridElement.querySelector(`.cell[data-row="${nextRow}"][data-col="${nextCol}"]`);
                if (nextCell) {
                    const nextInput = nextCell.querySelector('.cell-input');
                    if (nextInput) nextInput.focus();
                }
            }
        }
    }
    
    updateStatusPill();
}

// Renders 3x3 Auto Note candidates dynamically inside empty cells
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

// Updates the text of the status pill without highlighting cells in red
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

// Highlights cells with conflicts in red and returns true if any exist
function showValidationConflicts() {
    const conflicts = getBoardConflicts(board);
    
    // Remove old conflict highlighting
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

// Action Bar Buttons Setup
function setupActionBar() {
    // Validate Button
    document.getElementById('btn-validate').addEventListener('click', () => {
        const hasConflicts = showValidationConflicts();
        if (hasConflicts) {
            explanationBody.innerHTML = `
                <div style="color: var(--accent-error); font-weight:600;">Validation Failed!</div>
                The grid contains duplicate numbers in rows, columns, or 3x3 subgrids. Conflicting cells are highlighted in red.
            `;
            document.getElementById('card-explanation').classList.add('open');
        } else {
            // Check if solvable
            const testResult = solve(board);
            if (testResult.solved) {
                explanationBody.innerHTML = `
                    <div style="color: var(--accent-success); font-weight:600;">Grid is Valid and Solvable!</div>
                    No conflicts found. Try requesting a Hint or click Solve to complete the puzzle.
                `;
            } else {
                statusPill.innerText = "Impossible";
                statusPill.className = "status-pill invalid";
                explanationBody.innerHTML = `
                    <div style="color: var(--accent-error); font-weight:600;">Impossible Puzzle!</div>
                    Although there are no direct duplicate conflicts, this layout is impossible to solve under Sudoku rules.
                `;
            }
            document.getElementById('card-explanation').classList.add('open');
        }
    });

    // Hint Button
    document.getElementById('btn-hint').addEventListener('click', () => {
        // Clear old highlights
        gridElement.querySelectorAll('.cell').forEach(c => c.classList.remove('hint-pulse'));
        
        const hint = getLogicalHint(board);
        if (hint) {
            const cell = gridElement.querySelector(`.cell[data-row="${hint.row}"][data-col="${hint.col}"]`);
            if (cell) {
                cell.classList.add('hint-pulse');
                setActiveCell(hint.row, hint.col);
            }
            
            explanationBody.innerHTML = `
                <div style="font-weight: 700; color: var(--accent-success); margin-bottom:4px;">Hint: ${hint.type}</div>
                <div class="explanation-text">${hint.reason}</div>
                <div class="reason-highlight">${hint.details.replace(/\n/g, '<br>')}</div>
            `;
        } else {
            explanationBody.innerText = "No logical hint found. Advanced solving (backtracking solver) required.";
        }
        document.getElementById('card-explanation').classList.add('open');
    });

    // Next Move Button
    document.getElementById('btn-next-move').addEventListener('click', () => {
        // Find single logical step
        const hint = getLogicalHint(board);
        if (hint) {
            updateCellValue(hint.row, hint.col, hint.value);
            const cell = gridElement.querySelector(`.cell[data-row="${hint.row}"][data-col="${hint.col}"]`);
            if (cell) {
                cell.classList.add('hint-pulse');
                setTimeout(() => cell.classList.remove('hint-pulse'), 1500);
            }
            explanationBody.innerHTML = `
                <div style="font-weight: 600; color: var(--accent-success);">Logical Move Placed!</div>
                Filled cell at Row ${hint.row + 1}, Col ${hint.col + 1} with ${hint.value} (${hint.type}).
            `;
        } else {
            // No logical move: perform backtracking solve, extract first filled cell
            const result = solve(board);
            if (result.solved) {
                // Find first difference
                let filled = false;
                for (let r = 0; r < 9; r++) {
                    for (let c = 0; c < 9; c++) {
                        if (board[r][c] === 0 && result.board[r][c] !== 0) {
                            updateCellValue(r, c, result.board[r][c]);
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

    // Solve Button
    document.getElementById('btn-solve').addEventListener('click', () => {
        // Highlight conflicts if any, and prevent solve
        const hasConflicts = showValidationConflicts();
        if (hasConflicts) {
            explanationBody.innerHTML = `
                <div style="color: var(--accent-error); font-weight:600;">Solve Failed!</div>
                The grid contains duplicate numbers in rows, columns, or 3x3 subgrids. Conflicting cells are highlighted in red.
            `;
            document.getElementById('card-explanation').classList.add('open');
            return;
        }

        // Save state for undo/reset capability
        preSolveBoard = cloneBoard(board);
        
        const startTime = performance.now();
        const result = solve(board);
        const endTime = performance.now();
        const elapsed = (endTime - startTime).toFixed(2);
        
        if (result.solved) {
            // Update local board structure
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (board[r][c] === 0) {
                        board[r][c] = result.board[r][c];
                        const cell = gridElement.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
                        
                        // Add textual value
                        const textNode = Array.from(cell.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
                        if (textNode) {
                            textNode.nodeValue = result.board[r][c];
                        } else {
                            cell.appendChild(document.createTextNode(result.board[r][c]));
                        }
                        
                        cell.classList.add('inserted');
                        setTimeout(() => cell.classList.remove('inserted'), 300);
                    }
                }
            }
            
            renderNotes();
            saveState();
            
            // Set stats
            statTime.innerText = `${elapsed} ms`;
            statCalls.innerText = result.steps;
            updateStats();
            updateStatusPill();
            
            // Set difficulty
            const diff = estimateDifficulty(preSolveBoard, result.steps);
            difficultyPill.innerText = diff;
            
            explanationBody.innerHTML = `
                <div style="color: var(--accent-success); font-weight:700;">Puzzle Solved!</div>
                Solver completed in <strong>${elapsed} ms</strong> with <strong>${result.steps} recursive calls</strong>.<br>
                Difficulty assessed: <strong>${diff}</strong>.
            `;
            
            // Open stats and explanations cards
            document.getElementById('card-stats').classList.add('open');
            document.getElementById('card-explanation').classList.add('open');
        } else {
            explanationBody.innerHTML = `<span style="color: var(--accent-error);">Solver failed. Grid has duplicate entries or is impossible to solve.</span>`;
            document.getElementById('card-explanation').classList.add('open');
        }
    });

    // More Operations Button (Toggles bottom sheet menu on mobile)
    document.getElementById('btn-more').addEventListener('click', () => {
        openSheet();
    });
}

// Drawer Bottom Sheet controls
function setupBottomSheet() {
    // Reset Board Action
    document.getElementById('btn-reset').addEventListener('click', () => {
        board = cloneBoard(preSolveBoard);
        syncBoardToDOM();
        saveState();
        updateStats();
        updateStatusPill();
        explanationBody.innerText = "Board restored to pre-solve state.";
    });

    // Clear Grid Action
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
        
        // Reset pills
        difficultyPill.innerText = "N/A";
        statusPill.innerText = "Empty";
        statusPill.className = "status-pill";
        explanationBody.innerText = "Grid cleared. Start entering your board.";
    });

    // Example selector
    const selector = document.getElementById('select-puzzle');
    selector.addEventListener('change', (e) => {
        const mode = e.target.value;
        if (mode && PUZZLES[mode]) {
            loadBoardString(PUZZLES[mode]);
            closeSheet();
            selector.value = ""; // Reset selector
        }
    });

    // Undo / Redo Click actions
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
}

// Opens the mobile drawer
function openSheet() {
    bottomSheet.classList.add('active');
    sheetOverlay.classList.add('active');
}

window.closeSheet = function() {
    bottomSheet.classList.remove('active');
    sheetOverlay.classList.remove('active');
};

// Undo/Redo State Management
function saveState() {
    // Truncate history if we were in the middle of undo stack
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

// Sync Javascript internal board to visual UI elements
function syncBoardToDOM() {
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const cell = gridElement.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
            
            // Clean dynamic helper states
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

// String code parser to load puzzles (Supports copy/paste templates)
function loadBoardString(sudokuStr) {
    if (sudokuStr.length !== 81) return;
    
    // Reset state before loading
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
    
    // Reset history stack
    history = [];
    historyIndex = -1;
    saveState();
    
    updateStats();
    updateStatusPill();
    
    // Estimate difficulty based on clues loaded
    difficultyPill.innerText = estimateDifficulty(board, 0);
    explanationBody.innerText = "New puzzle template loaded successfully.";
}

// Board statistics calculation
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

// Modal import/export triggers
function setupModals() {
    // Import Dialog
    document.getElementById('btn-import-prompt').addEventListener('click', () => {
        closeSheet();
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
            alert("Error: Sudoku code must be exactly 81 characters containing digits 0-9 or dots.");
        }
    });

    // Export Dialog
    document.getElementById('btn-export-prompt').addEventListener('click', () => {
        closeSheet();
        modalExport.classList.add('active');
        
        // Build 81 character export string
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

// Keyboard Shortcuts and Arrow Navigation
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Let inputs handle typing inside modals
        if (document.activeElement.tagName === 'INPUT') {
            // If focused on grid cell, allow navigation but block typing duplication
            if (document.activeElement.classList.contains('cell-input')) {
                if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'escape', 'z', 'y'].includes(e.key.toLowerCase())) {
                    return;
                }
            } else {
                return; // block entirely for normal text inputs/modals
            }
        }

        // Ctrl + Z = Undo
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
            return;
        }
        
        // Ctrl + Y = Redo
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redo();
            return;
        }

        if (!activeCell) return;
        const { row, col } = activeCell;

        if (e.key >= '1' && e.key <= '9') {
            if (!givens[row][col]) updateCellValue(row, col, parseInt(e.key), true);
            e.preventDefault();
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            if (!givens[row][col]) updateCellValue(row, col, 0, true);
            e.preventDefault();
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
