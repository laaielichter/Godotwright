Make an enemy flash white when it is hit.

Use the shader res://shaders/flash.gdshader on the enemy's Sprite2D. When `hit()` is called on an enemy, set the shader's `amount` uniform to 1 and tween it back to 0 over 0.2 seconds. Only the enemy that was hit flashes; the other enemies stay as they are.
