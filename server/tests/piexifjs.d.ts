declare module 'piexifjs' {
  const piexif: {
    dump(exifObj: Record<string, Record<number, unknown>>): string
    insert(exifBytes: string, jpegData: string): string
    ExifIFD: { DateTimeOriginal: number }
    ImageIFD: { Orientation: number }
    GPSIFD: {
      GPSLatitudeRef: number
      GPSLatitude: number
      GPSLongitudeRef: number
      GPSLongitude: number
    }
    GPSHelper: { degToDmsRational(deg: number): [number, number][] }
  }
  export default piexif
}
