"""
Script to generate icon PNG files for the extension
Requires Pillow: pip install Pillow
"""
from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size, output_path):
    """Create a gradient icon with 'VI' text"""
    # Create image with transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw rounded rectangle with gradient effect
    # Create gradient by drawing multiple rectangles
    for i in range(size):
        # Calculate color for gradient (purple to blue)
        ratio = i / size
        r = int(102 * (1 - ratio) + 118 * ratio)
        g = int(126 * (1 - ratio) + 75 * ratio)
        b = int(234 * (1 - ratio) + 162 * ratio)
        
        color = (r, g, b, 255)
        draw.rectangle([0, i, size, i+1], fill=color)
    
    # Draw rounded corners mask
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    corner_radius = size // 5
    mask_draw.rounded_rectangle([0, 0, size, size], radius=corner_radius, fill=255)
    
    # Apply mask
    img.putalpha(mask)
    
    # Add "VI" text
    try:
        # Try to use a bold font if available
        font_size = int(size * 0.45)
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except:
            font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", font_size)
    except:
        # Fallback to default font
        font = ImageFont.load_default()
    
    # Draw text
    text = "VI"
    # Get text bounding box
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Center text
    x = (size - text_width) // 2
    y = (size - text_height) // 2 - bbox[1]
    
    draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)
    
    # Save image
    img.save(output_path, 'PNG')
    print(f"Created {output_path}")

def main():
    # Get script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(script_dir, 'icons')
    
    # Create icons directory if it doesn't exist
    os.makedirs(icons_dir, exist_ok=True)
    
    # Generate icons in different sizes
    sizes = [16, 48, 128]
    for size in sizes:
        output_path = os.path.join(icons_dir, f'icon{size}.png')
        create_icon(size, output_path)
    
    print("\nAll icons created successfully!")
    print("You can now load the extension in Edge.")

if __name__ == '__main__':
    main()
