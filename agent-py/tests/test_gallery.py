from __future__ import annotations

import unittest

from prakash_agent.graph import merge_recovered_images, needs_image_recovery


class GalleryRecoveryTests(unittest.TestCase):
    def test_recovery_runs_for_any_gallery_below_three(self) -> None:
        self.assertTrue(needs_image_recovery([], attempted=False))
        self.assertTrue(needs_image_recovery([{"url": "one"}], attempted=False))
        self.assertFalse(needs_image_recovery([{"url": "one"}] * 3, attempted=False))
        self.assertFalse(needs_image_recovery([], attempted=True))

    def test_recovery_keeps_the_cover_and_deduplicates_sources(self) -> None:
        current = [{"url": "/media/watch/cover.webp", "source_url": "https://shop.test/front"}]
        recovered = [
            {"url": "/media/watch/same.webp", "source_url": "https://shop.test/front"},
            {"url": "/media/watch/side.webp", "source_url": "https://shop.test/side"},
            {"url": "/media/watch/back.webp", "source_url": "https://shop.test/back"},
        ]

        merged = merge_recovered_images(current, recovered, 3)

        self.assertEqual(
            [image["url"] for image in merged],
            [
                "/media/watch/cover.webp",
                "/media/watch/side.webp",
                "/media/watch/back.webp",
            ],
        )


if __name__ == "__main__":
    unittest.main()
