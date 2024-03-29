import { db } from '@/db'
import { getImageFromDallE } from '@/external/dall-e'
import { eq, sql } from 'drizzle-orm'
import { checkAndSafeParseToBody, handler } from '@/lib/utils'
import { Category } from '@/schema/models/category.model'
import { Image } from '@/schema/models/image.model'
import { postImageBody } from '@/validation/image.validation'
import { NextRequest, NextResponse } from 'next/server'
import { uploadImage } from '@/external/upload-image'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category') || ''
    const foundCategoryWithRelationImages =
      (
        await db.execute(sql`
  select 
    *
    ,
    (select
      coalesce(json_agg(jsonb_build_object(
          'id',"images"."id", 
      'createdAt',"images"."createdAt",
      'word',"images"."word",
      'original_url',"images"."original_url",
      'review_url',"images"."review_url"
          )),
      '[]') images
    from
      (
      select
        *
      from
        (
        select
          row_number() over (partition by word
        order by
          "i"."createdAt" desc) as ROWNUM,
          "i"."id",
          "i"."createdAt",
          "i"."word",
          "i"."original_url",
          "i"."review_url",
          "i"."category_id"
        from
          "image" "i"
        where
          "i".category_id = c.id) as "image_with_rownum"
      where
        "image_with_rownum".ROWNUM = 1 limit 5) images)
    from category c  where c.name = ${category} limit 1`)
      )?.rows?.[0] || undefined
    return NextResponse.json(handler({ data: foundCategoryWithRelationImages }))
  } catch (err) {
    console.error(err)
    return NextResponse.json(
      handler({
        error: {
          message: '이미지를 찾지 못했어요. 잠시 후 다시 시도해주세요.',
        },
      }),
      { status: 400 },
    )
  }
}

export async function POST(req: NextRequest) {
  const { validate, data } = await checkAndSafeParseToBody(req, postImageBody)

  if (!validate) {
    return NextResponse.json(
      handler({
        error: {
          message: 'error',
          detail: data,
        },
      }),
      {
        status: 400,
      },
    )
  }

  try {
    const { categoryName, words } = data
    const foundCategory = await db
      .select()
      .from(Category)
      .where(eq(Category.name, categoryName))
    if (!foundCategory.length) throw Error()
    const response = await getImageFromDallE(words)

    const uploadPromises = response.map((image) => uploadImage(image))
    const cloudinaryResponse = await Promise.all(uploadPromises)
    await db.insert(Image).values(
      cloudinaryResponse.map((item) => ({
        word: item.keyword,
        categoryId: foundCategory[0].id,
        originalUrl: item.secure_url,
      })),
    )

    return NextResponse.json(
      handler({
        data: {
          category: categoryName,
          images: cloudinaryResponse.map((res) => ({
            keyword: res.keyword,
            url: res.secure_url,
          })),
        },
      }),
    )
  } catch (err) {
    return NextResponse.json(
      handler({
        error: {
          message: '이미지를 생성하지 못했어요. 잠시 후 다시 시도해주세요.',
        },
      }),
    )
  }
}
