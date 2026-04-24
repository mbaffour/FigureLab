# FigureLab: A browser-based figure assembly tool for microscopists

**Try it now → [mbaffour.github.io/FigureLab/figure_lab.html](https://mbaffour.github.io/FigureLab/figure_lab.html)**
**Source code → [github.com/mbaffour/FigureLab](https://github.com/mbaffour/FigureLab)**

---

There is a Ghanaian adage about a piglet quizzing their mother about why she has such a big snout, only for the mother to respond that it was a matter of time before the piglet would grow to experience such a predicament.

I first encountered this particular predicament at a Texas ASM Branch meeting. I was sitting behind someone working on their laptop, wrestling with ImageJ, Inkscape, and PowerPoint. Cropping a microscopy panel. Dragging it into Inkscape. Trying to align a set of figures. I watched for a few minutes before quietly looking away — privately glad it wasn't me, and privately filing it away as something deeply familiar.

Then it was me.

I had a set of N4 phage infection time-course images that needed to become an eight-panel figure for a manuscript. Calibrated scale bars, annotations to add, brightness adjustments to make. I know Fiji well. I know Inkscape well. I have done this before. And yet two hours in, I was exporting the same TIFF for the fifth time because the panel labels kept rendering at the wrong size, the scale bar math was off when I cropped the image, and the SVG I had painstakingly annotated had lost half its arrows when I reopened it. To add salt to injury, I could not seem to align everything perfectly.

I ended up with a figure I did not like, assembled through a process I hated, using tools I respect but that were simply not designed for this job.

So I did what I sometimes do when I hit a wall in this age of AI: I remembered that you can just build things.

---

## The actual problem with figure assembly

To be clear, Fiji is excellent software. ImageJ has been the backbone of biological image analysis for decades, and the community that built and maintains it deserves enormous credit. Inkscape is a genuinely powerful vector editor. The problem is not that these tools are bad. The problem is that making a publication figure involves a very specific workflow — arrange panels in a grid, apply uniform brightness adjustments, add calibrated scale bars, annotate with arrows and labels, export at 300 or 600 DPI — and none of the standard academic tools were designed specifically for that workflow. You are constantly leaving one application and entering another, re-importing files, re-doing work.

The hidden cost is not the time per se. It is the fragmentation. Your figure exists simultaneously as a Fiji macro, a set of exported TIFFs, an Inkscape SVG, and a mental model of how they all relate. When something changes — a reviewer wants panel C cropped differently, or the scale bar moved — you go back to the beginning of the chain.

### The specific failures I kept hitting

Scale bar pixel math that ignored my crop region, giving me a bar that was visually correct but numerically wrong. SVG exports from Fiji that silently dropped my annotations when reopened. PNG files that looked fine on screen but were flagged as 72 DPI by the journal submission portal. A session file that crashed when I had more than four large TIFF files loaded.

These are not exotic edge cases. These are the normal workflow for any microscopy-heavy biology paper.

---

## What I built

[FigureLab](https://mbaffour.github.io/FigureLab/figure_lab.html) is a single HTML file. You open it in your browser. You drag in your images. You build your figure. You export it. There is no installation, no account, no server, no data leaving your machine. I deliberately kept it as a single file because the last thing a stressed PhD student needs is a dependency to manage.

The core loop is simple: drop images into a panel grid, adjust each one independently (crop, brightness, scale bar), annotate directly on the canvas, apply a journal preset, and export. But I tried to get the details right — specifically the things that are always wrong in cobbled-together workflows.

- **Scale bars that are mathematically correct at any crop level**, with automatic round-number length selection (1, 2, 5, 10, 20, 50 µm — whichever fits cleanly in about 20% of the panel width)
- **Drag-to-reorder panels** directly on the canvas — grab a panel, drag it to another slot, they swap
- **Zeiss LSM metadata auto-read** — open a `.lsm` file and the µm/px calibration populates automatically from the VoxelSizeX embedded in the file
- **Annotations that export correctly as vectors** in SVG, not baked into the pixel data
- **Journal presets** for Nature, Science, Cell, and poster formats, encoding actual submission spec values
- **A reproducibility script export** (Python and R) that reconstructs the figure from your source files, for methods sections and lab records
- **A compliance checker** that tells you whether your figure meets the column width, DPI, and font size requirements of a given journal before you submit

I also fixed the things that are silently wrong in most simple canvas-based tools. PNG exports embed DPI in the pHYs chunk so the file actually claims 300 DPI, not 72. TIFF exports write a real TIFF with an sRGB ICC profile, not a PNG with a renamed extension. The undo system uses a command pattern so image operations — deleting a panel, reordering, changing brightness — are all reversible without copying megabytes of image data on every action.

---

## On building tools as a scientist

I want to say something about the act of building this, separate from what it does.

There is a version of scientific training that treats tool-building as a distraction from real science. Get the data, analyze it, write it up, move on. The tools you use are someone else's problem. And there is real wisdom in that: time spent building infrastructure is time not spent at the bench, and a half-finished tool that only you know how to use is not obviously more valuable than just using Inkscape badly for another six months.

But there is another version — one I have come to believe more fully as my PhD has progressed — that the act of building a tool forces you to understand a problem at a depth that using tools never does. When I wrote the scale bar rendering code, I had to think carefully about what "calibrated" actually means when you have cropped an image. The source pixel width after cropping is not the same as the original image width, and getting that wrong produces a scale bar that looks right but lies. I would not have thought carefully about that distinction if I were just dragging a scale bar in Fiji.

> *The act of building a tool forces you to understand a problem at a depth that using tools never does.*

There is also something to be said for the kind of frustration that tips over into action. Most of the time I encounter a bad tool, I adapt. I learn the workaround. I add another step to the workflow. I accept the friction as the cost of doing business. Watching that person at the conference, spiraling through the same loop I knew intimately, made the problem visible in a way my own experience had normalized. And then when I hit the same wall myself, hard enough, the adaptation response was not available anymore. The only remaining option was to build something.

I am not claiming FigureLab is finished. It has gaps I know about and probably gaps I do not. But it is real, it runs, and it has already saved me more time than it took to build. That seems like the right bar for whether something was worth doing.

---

## A note on how it was built

FigureLab was built collaboratively with [Claude](https://claude.ai) (Anthropic's AI). The ideas, the workflow design, the frustration that motivated it, and the decisions about what to build — those are mine. Claude was the implementation partner: writing and debugging the canvas rendering code, the TIFF export logic, the annotation system, the scale bar math. Working this way let me turn a specific scientific frustration into a working tool faster than I could have alone, and I think it is worth being transparent about that. The source is on GitHub. If you find something wrong or want to add something, issues and pull requests are welcome.

---

## How to use it

**[Open FigureLab in your browser →](https://mbaffour.github.io/FigureLab/figure_lab.html)**

Drag in your images. The interface should be self-explanatory. If it is not, that is a bug I want to know about. Press **?** for the full keyboard shortcut reference. Sessions save as JSON so you can close the tab and come back.

For Zeiss users: drag in your `.lsm` or `.tiff` files directly. If the file has ImageJ or Zeiss calibration metadata embedded, the scale bar will auto-populate. For CZI files, the metadata is read but the image itself requires export from ZEN first, as the browser cannot decode JPEG 2000 tile compression natively.

The Python and R export scripts in the Export panel generate code that recreates your figure from the source files. If your lab has a pipeline or you need to regenerate figures programmatically, that is the right path.

**Source and issues: [github.com/mbaffour/FigureLab](https://github.com/mbaffour/FigureLab)**

If you work on a feature, reach out. I would rather coordinate than have two people solve the same problem separately.
