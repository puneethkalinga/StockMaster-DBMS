"""
StockMaster Interactive SQL Console
Standalone CLI query tool for live query demonstrations during Review 2 Viva.
"""
import sqlite3
import os
import sys
import time

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database", "inventory_system.db")
if not os.path.exists(DB_PATH):
    # fallback to root db
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "inventory_system.db")

def print_table(columns, rows):
    if not columns:
        print("Empty result set (0 rows).")
        return

    # Calculate max width per column
    col_widths = [len(str(col)) for col in columns]
    str_rows = []
    for r in rows:
        row_str = [str(val) if val is not None else "NULL" for val in r]
        str_rows.append(row_str)
        for i, val in enumerate(row_str):
            col_widths[i] = max(col_widths[i], len(val))

    # Cap column width at 40 chars for clean readability
    col_widths = [min(w, 40) for w in col_widths]

    # Build separator line
    sep = "+" + "+".join("-" * (w + 2) for w in col_widths) + "+"

    print(sep)
    header_line = "|" + "|".join(f" {str(col)[:w]:<{w}} " for col, w in zip(columns, col_widths)) + "|"
    print(header_line)
    print(sep)

    for r in str_rows:
        row_line = "|" + "|".join(f" {val[:w]:<{w}} " for val, w in zip(r, col_widths)) + "|"
        print(row_line)

    print(sep)

def execute_query(conn, query):
    query = query.strip()
    if not query:
        return

    if query.lower() in [".tables", "show tables", "tables"]:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
        tables = [r[0] for r in cursor.fetchall()]
        print("\n=== StockMaster Relational Tables (11 BCNF Tables) ===")
        for i, t in enumerate(tables, 1):
            print(f"  {i:2d}. {t}")
        print()
        return

    if query.lower().startswith(".schema"):
        parts = query.split()
        cursor = conn.cursor()
        if len(parts) > 1:
            tbl = parts[1]
            cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?;", (tbl,))
            res = cursor.fetchone()
            if res:
                print(f"\n{res[0]};\n")
            else:
                print(f"Table '{tbl}' not found.")
        else:
            cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
            for r in cursor.fetchall():
                if r[0]:
                    print(f"{r[0]};\n")
        return

    start_time = time.time()
    try:
        cursor = conn.cursor()
        cursor.execute(query)
        if query.lower().startswith(("select", "pragma", "with", "explain")):
            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            elapsed_ms = (time.time() - start_time) * 1000
            print()
            print_table(columns, rows)
            print(f"({len(rows)} row{'s' if len(rows) != 1 else ''} returned in {elapsed_ms:.1f} ms)\n")
        else:
            conn.commit()
            elapsed_ms = (time.time() - start_time) * 1000
            print(f"\nQuery executed successfully. ({cursor.rowcount} row{'s' if cursor.rowcount != 1 else ''} affected in {elapsed_ms:.1f} ms)\n")
    except Exception as e:
        print(f"\n[SQL Error]: {e}\n")

def main():
    if not os.path.exists(DB_PATH):
        print(f"Error: Database file not found at {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")

    # If query passed as CLI argument
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
        execute_query(conn, query)
        conn.close()
        return

    # Interactive mode
    print("=" * 70)
    print("  STOCKMASTER — INTERACTIVE SQL CONSOLE (DBMS VIVA READY)")
    print(f"  Connected to: {os.path.basename(DB_PATH)} | Foreign Keys: ON (Enforced)")
    print("=" * 70)
    print("  Commands:")
    print("    • Type ANY SQL query and end with ';' or press Enter")
    print("    • Type '.tables' to list all 11 tables")
    print("    • Type '.schema <tablename>' to see table CREATE statement")
    print("    • Type 'exit' or 'quit' to close")
    print("=" * 70)
    print()

    query_buffer = []
    while True:
        try:
            prompt = "SQL> " if not query_buffer else " ... "
            line = input(prompt)
            clean_line = line.strip()

            if not query_buffer and clean_line.lower() in ["exit", "quit", "q", "\\q"]:
                print("Exiting SQL Console.")
                break

            if not query_buffer and clean_line.startswith("."):
                execute_query(conn, clean_line)
                continue

            if not clean_line and not query_buffer:
                continue

            query_buffer.append(line)

            # If line ends with semicolon or single-line query
            if clean_line.endswith(";"):
                full_query = " ".join(query_buffer)
                query_buffer = []
                execute_query(conn, full_query)

        except (KeyboardInterrupt, EOFError):
            print("\nExiting SQL Console.")
            break

    conn.close()

if __name__ == "__main__":
    main()
