import os

filepath = '/home/gustavodslara/dev/git-repos/public/svelte-threejs-unrendergames-landingpage/src/lib/FortnitePage.svelte'

with open(filepath, 'r') as f:
    lines = f.readlines()

# Extract segments (1-indexed translation to 0-indexed python)
text_chunk = lines[363:406]
video_chunk = lines[407:421]
char_chunk = lines[424:433]
dance_chunk = lines[440:562]
grid_chunk = lines[564:770]
float_chunk = lines[771:780]

# Modify segments
for i, line in enumerate(text_chunk):
    if "order-2 lg:order-1" in line:
        text_chunk[i] = line.replace("order-2 lg:order-1", "")
        # Also let's make the text aligned to left still, but since it was in left column it's fine.
        break

for i, line in enumerate(video_chunk):
    if "order-1 lg:order-2" in line:
        video_chunk[i] = line.replace("order-1 lg:order-2", "mb-4 lg:mb-6")
        break

# Rebuild document
new_main = []
new_main.extend(lines[349:358]) # '<main' up to before left-col

# New left column (Contains Video and Grid)
new_main.append('      <div\n')
new_main.append('        class="left-column w-full lg:col-span-7 xl:col-span-7 flex flex-col pt-0 justify-center gap-4 lg:gap-6 order-2 lg:order-1 z-10"\n')
new_main.append('      >\n')
new_main.extend(video_chunk)

# For the grid, we want it to be order-2
# Currently grid chunk first lines:
#         <!-- Game Features are now in the right column -->
#         <div
#           class="shrink min-h-0 w-full lg:w-full bg-transparent z-10 relative mt-6 sm:mt-10 md:mt-14 lg:mt-0"
for i, line in enumerate(grid_chunk):
    if "class=\"shrink min-h-0 w-full" in line:
        grid_chunk[i] = line.replace('mt-6 sm:mt-10 md:mt-14 lg:mt-0', 'mt-2 sm:mt-4 lg:mt-0 order-2')
        break

new_main.extend(grid_chunk)
new_main.append('      </div>\n\n')

# Character Image (Midas)
new_main.extend(char_chunk)

# New right column (Contains Text and 3D Model)
new_main.append('      <!-- RIGHT COLUMN: Text, 3D Model -->\n')
new_main.append('      <div\n')
new_main.append('        class="right-column w-full lg:col-span-5 flex flex-col justify-start items-start lg:items-start z-20 order-1 lg:order-2 gap-6 pb-2 lg:pb-0"\n')
new_main.append('      >\n')
new_main.extend(text_chunk)
new_main.extend(dance_chunk)
new_main.extend(float_chunk)
new_main.append('      </div>\n')

# The rest
new_main.extend(lines[781:784])

final_lines = lines[:349] + new_main + lines[784:]

with open(filepath, 'w') as f:
    f.writelines(final_lines)

print("Replacement complete")
