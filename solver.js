/**
 * Sudoku Solver and Hint Engine Module
 * Pure ES6 implementation. Runs entirely client-side.
 */

/**
 * Clones a 9x9 board.
 * @param {number[][]} board 
 * @returns {number[][]}
 */
export function cloneBoard(board) {
    return board.map(row => [...row]);
}

/**
 * Finds the first empty cell in sequential order.
 * @param {number[][]} board 
 * @returns {[number, number]|null}
 */
export function findEmpty(board) {
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (board[r][c] === 0) {
                return [r, c];
            }
        }
    }
    return null;
}

/**
 * Checks if a value can be placed at a specific cell without immediate conflicts.
 * @param {number[][]} board 
 * @param {number} r 
 * @param {number} c 
 * @param {number} val 
 * @returns {boolean}
 */
export function isValid(board, r, c, val) {
    // Check row
    for (let col = 0; col < 9; col++) {
        if (col !== c && board[r][col] === val) return false;
    }

    // Check column
    for (let row = 0; row < 9; row++) {
        if (row !== r && board[row][c] === val) return false;
    }

    // Check 3x3 box
    const boxRowStart = Math.floor(r / 3) * 3;
    const boxColStart = Math.floor(c / 3) * 3;
    for (let row = boxRowStart; row < boxRowStart + 3; row++) {
        for (let col = boxColStart; col < boxColStart + 3; col++) {
            if ((row !== r || col !== c) && board[row][col] === val) return false;
        }
    }

    return true;
}

/**
 * Validates the entire board. Returns true if there are no conflicts.
 * @param {number[][]} board 
 * @returns {boolean}
 */
export function isBoardValid(board) {
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const val = board[r][c];
            if (val !== 0 && !isValid(board, r, c, val)) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Finds all cell coordinates that contain conflicts.
 * @param {number[][]} board 
 * @returns {Array<{row: number, col: number}>}
 */
export function getBoardConflicts(board) {
    const conflicts = [];
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const val = board[r][c];
            if (val !== 0 && !isValid(board, r, c, val)) {
                conflicts.push({ row: r, col: c });
            }
        }
    }
    return conflicts;
}

/**
 * Returns all possible candidate numbers for a cell.
 * @param {number[][]} board 
 * @param {number} r 
 * @param {number} c 
 * @returns {number[]}
 */
export function getCandidates(board, r, c) {
    if (board[r][c] !== 0) return [];
    const candidates = [];
    for (let v = 1; v <= 9; v++) {
        if (isValid(board, r, c, v)) {
            candidates.push(v);
        }
    }
    return candidates;
}

/**
 * Solves the board using recursive backtracking with MRV (Minimum Remaining Values) heuristic.
 * This is extremely fast and records the number of recursive steps.
 * 
 * @param {number[][]} board 
 * @returns {{solved: boolean, board: number[][], steps: number}}
 */
export function solve(board) {
    const solvedBoard = cloneBoard(board);
    let steps = 0;

    function backtrack() {
        steps++;
        
        // Find empty cell with Minimum Remaining Values (MRV)
        let minCandidates = 10;
        let targetRow = -1;
        let targetCol = -1;
        let targetCandidates = null;

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (solvedBoard[r][c] === 0) {
                    const cands = getCandidates(solvedBoard, r, c);
                    if (cands.length < minCandidates) {
                        minCandidates = cands.length;
                        targetRow = r;
                        targetCol = c;
                        targetCandidates = cands;
                        if (minCandidates === 0) return false; // Dead end
                    }
                }
            }
        }

        // If no empty cells, board is solved
        if (targetRow === -1) return true;

        for (const val of targetCandidates) {
            solvedBoard[targetRow][targetCol] = val;
            if (backtrack()) return true;
            solvedBoard[targetRow][targetCol] = 0; // Backtrack
        }

        return false;
    }

    const success = backtrack();
    return {
        solved: success,
        board: success ? solvedBoard : board,
        steps: steps
    };
}

/**
 * Scans the board to find one simple logical move (Naked Single or Hidden Single).
 * 
 * @param {number[][]} board 
 * @returns {Object|null} Hint object or null if none found
 */
export function getLogicalHint(board) {
    // 1. Check for Naked Singles (cell has only 1 possible candidate)
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (board[r][c] === 0) {
                const candidates = getCandidates(board, r, c);
                if (candidates.length === 1) {
                    const value = candidates[0];
                    const rowValues = board[r].filter(v => v !== 0);
                    const colValues = [];
                    for (let row = 0; row < 9; row++) {
                        if (board[row][c] !== 0) colValues.push(board[row][c]);
                    }
                    const boxValues = [];
                    const boxRowStart = Math.floor(r / 3) * 3;
                    const boxColStart = Math.floor(c / 3) * 3;
                    for (let row = boxRowStart; row < boxRowStart + 3; row++) {
                        for (let col = boxColStart; col < boxColStart + 3; col++) {
                            if (board[row][col] !== 0) boxValues.push(board[row][col]);
                        }
                    }

                    return {
                        type: "Naked Single",
                        row: r,
                        col: c,
                        value: value,
                        reason: `Only number ${value} can fit here.`,
                        details: `Row ${r + 1} already contains: [${[...new Set(rowValues)].sort().join(", ")}].\n` +
                                 `Column ${c + 1} already contains: [${[...new Set(colValues)].sort().join(", ")}].\n` +
                                 `Box ${Math.floor(r / 3) * 3 + Math.floor(c / 3) + 1} already contains: [${[...new Set(boxValues)].sort().join(", ")}].\n` +
                                 `Therefore, only number ${value} fits.`
                    };
                }
            }
        }
    }

    // 2. Check for Hidden Singles in Rows (number can only go in one cell of a row)
    for (let r = 0; r < 9; r++) {
        for (let v = 1; v <= 9; v++) {
            // If v is already in row, skip
            if (board[r].includes(v)) continue;

            const possibleCols = [];
            for (let c = 0; c < 9; c++) {
                if (board[r][c] === 0 && isValid(board, r, c, v)) {
                    possibleCols.push(c);
                }
            }

            if (possibleCols.length === 1) {
                const c = possibleCols[0];
                return {
                    type: "Hidden Single (Row)",
                    row: r,
                    col: c,
                    value: v,
                    reason: `In Row ${r + 1}, the number ${v} can only fit in Column ${c + 1}.`,
                    details: `Although other cells are empty, Row ${r + 1} needs a ${v}, and this is the only cell in the row that doesn't conflict with columns or 3x3 boxes containing ${v}.`
                };
            }
        }
    }

    // 3. Check for Hidden Singles in Columns (number can only go in one cell of a column)
    for (let c = 0; c < 9; c++) {
        const colValues = [];
        for (let r = 0; r < 9; r++) colValues.push(board[r][c]);

        for (let v = 1; v <= 9; v++) {
            if (colValues.includes(v)) continue;

            const possibleRows = [];
            for (let r = 0; r < 9; r++) {
                if (board[r][c] === 0 && isValid(board, r, c, v)) {
                    possibleRows.push(r);
                }
            }

            if (possibleRows.length === 1) {
                const r = possibleRows[0];
                return {
                    type: "Hidden Single (Column)",
                    row: r,
                    col: c,
                    value: v,
                    reason: `In Column ${c + 1}, the number ${v} can only fit in Row ${r + 1}.`,
                    details: `Although other cells are empty, Column ${c + 1} needs a ${v}, and this is the only cell in the column that doesn't conflict with rows or 3x3 boxes containing ${v}.`
                };
            }
        }
    }

    // 4. Check for Hidden Singles in Boxes (number can only go in one cell of a box)
    for (let b = 0; b < 9; b++) {
        const boxRowStart = Math.floor(b / 3) * 3;
        const boxColStart = (b % 3) * 3;

        const boxValues = [];
        for (let r = boxRowStart; r < boxRowStart + 3; r++) {
            for (let c = boxColStart; c < boxColStart + 3; c++) {
                if (board[r][c] !== 0) boxValues.push(board[r][c]);
            }
        }

        for (let v = 1; v <= 9; v++) {
            if (boxValues.includes(v)) continue;

            const possibleCells = [];
            for (let r = boxRowStart; r < boxRowStart + 3; r++) {
                for (let c = boxColStart; c < boxColStart + 3; c++) {
                    if (board[r][c] === 0 && isValid(board, r, c, v)) {
                        possibleCells.push({ row: r, col: c });
                    }
                }
            }

            if (possibleCells.length === 1) {
                const { row: r, col: c } = possibleCells[0];
                return {
                    type: "Hidden Single (Box)",
                    row: r,
                    col: c,
                    value: v,
                    reason: `In 3x3 Box ${b + 1}, the number ${v} can only fit in Row ${r + 1}, Column ${c + 1}.`,
                    details: `The 3x3 Box requires ${v}, and this is the only remaining cell in the box where it can be placed without violating row/column constraints.`
                };
            }
        }
    }

    return null;
}

/**
 * Estimates difficulty of the board.
 * Heuristic is based on number of starting clues and solver complexity.
 * 
 * @param {number[][]} board 
 * @param {number} solverSteps 
 * @returns {string} Easy, Medium, Hard, Expert
 */
export function estimateDifficulty(board, solverSteps) {
    let clues = 0;
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (board[r][c] !== 0) clues++;
        }
    }

    // Heuristics
    if (clues >= 38 && solverSteps < 15) {
        return "Easy";
    } else if (clues >= 30 && solverSteps < 80) {
        return "Medium";
    } else if (clues >= 24 && solverSteps < 500) {
        return "Hard";
    } else {
        return "Expert";
    }
}
