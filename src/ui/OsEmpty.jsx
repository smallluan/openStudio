import { Empty } from "tdesign-react";
import emptyImage from "../assets/images/empty.png";

/** @typedef {import("tdesign-react").EmptyProps} OsEmptyProps */

/** @param {OsEmptyProps} props */
export default function OsEmpty({ image, ...props }) {
  const imageNode =
    image ??
    (
      <img
        src={emptyImage}
        alt=""
        aria-hidden
        className="os-empty__image"
      />
    );

  return <Empty image={imageNode} {...props} />;
}
