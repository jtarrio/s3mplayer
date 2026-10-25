# s3mplayer

When I was so naively thinking of remaking "Second Reality" for HTML5, I also wrote an S3M player. It was very much an "only needs to play the one song" affair, but in April 2025 I thought I could extract it to a standalone TypeScript library and fix it up so it could play anything.

For one reason or other I put it away after one month when I was in the middle of adding test S3M to compare ST with my player (which helped me find and fix many issues) and forgot about it.

Today I remembered it and, for a lark, asked Gemini to fix it.

Boom. Done.

Nothing is meaningful anymore.

So here it is.

# Notes

If you want to listen to some S3M, you can put then in the `examples` directory and add them to `songs.js`.

Then run `npm run build` and then open `playsong.html` on your favorite browser.

# License

Copyright 2026 Jacobo Tarrio Barreiro

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
