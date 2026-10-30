Drop a coin when an enemy touches the player.

When an enemy touches the player (its `_on_body_entered` in res://scripts/enemy.gd), it should also drop a coin: an instance of res://scenes/coin.tscn, placed at the enemy's position and added to the enemy's parent, so the coin stays when the enemy is removed. The coin must work like any other Area2D in the game.
