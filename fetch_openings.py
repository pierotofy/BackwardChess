import requests
import json
import time

base_url = "https://explorer.lichess.ovh/masters"
output = []

def fetch_opening(moves=[], prev_name="", max_depth=3):
    depth = len(moves)
    if depth >= max_depth:
        return output.append({
            'name': prev_name,
            'moves': moves
        })

    if depth <= 2:
        n_moves = 3
    elif depth <= 5:
        n_moves = 2
    else:
        n_moves = 1
    
    params = {
        'play': ",".join(moves),
        'moves': n_moves,
        'topGames': 1
    }

    time.sleep(0.5)
    res = requests.get(base_url, params=params)
    if res.status_code != 200:
        raise Exception(f"Got status code: {res.status_code}")
    res = res.json()

    if len(res.get('moves', [])) == 0:
        return output.append({
            'name': prev_name,
            'moves': moves
        })
    
    for move in res.get('moves', [])[:n_moves]:
        new_moves = moves.copy()
        print(len(new_moves), new_moves)
        name = res.get('opening', {}).get('name', prev_name + " " + move['san'])
        uci = move['uci']

        new_moves.append(uci)
        fetch_opening(new_moves, name, max_depth)
    

fetch_opening(["e2e4", "c7c6"], max_depth=14)

with open("board/gen/caro-kann-14.json", "w", encoding="utf-8") as f:
    f.write(json.dumps(output, indent=4))