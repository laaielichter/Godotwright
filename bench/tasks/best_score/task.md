Keep a best score between game sessions.

In the GameState autoload (res://autoload/game_state.gd), add `best_score: int`.
Whenever the score goes above best_score, update best_score and save it to
user://save.cfg with ConfigFile (section "game", key "best").
When GameState starts, load best_score from that file if it exists.
